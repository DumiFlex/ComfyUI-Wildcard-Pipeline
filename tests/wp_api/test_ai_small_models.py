"""Small and medium models: steps asked in two parts (act, then answer),
tools loaded by group, the fixed prefix in Test connection, and the page
tools' forgiving checks. See `/pr-drafts/ai-small-model-plumbing.md`."""
from __future__ import annotations

import json

from engine.ai import chat as ai_chat
from engine.ai import client_tools
from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat, _two_wildcards
from tests.wp_api.test_ai_client_tools import _resume, searx  # noqa: F401,F811 - fixture
from wp_api import _ai_chat


def _on(fake_llm, model="m1", **extra):
    """A local server with a model the name doesn't size: medium."""
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model, **extra})


def _schema(seen):
    return seen["body"]["response_format"]["json_schema"]["schema"]


def _kind(seen):
    """"act" or "answer" for a split JSON ask."""
    props = _schema(seen)["properties"]
    return "act" if "calls" in props and "message" not in props else (
        "answer" if "calls" not in props else "step")


async def test_after_its_cards_a_split_step_writes_what_it_proposed(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "", "calls": [{"tool": "add_options", "args": json.dumps(
            {"id": tgt, "options": [{"text": "war axe"}]})}]},
        {"message": "", "calls": [{"tool": "run_test", "args": json.dumps(
            {"stack": ["Weapon"], "seeds": 20, "proposed": True})}]},
        {"message": "I've proposed a war axe; apply the card. The test picks it.",
         "calls": []},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "add a war axe to my Weapon")
    assert len(body["proposals"]) == 1
    assert body["message"] == "I've proposed a war axe; apply the card. The test picks it."
    assert [s["tool"] for s in body["steps"] if not s.get("think")] == [
        "read", "add_options", "run_test"]
    kinds = [_kind(x) for x in fake_llm.seen[n:]]
    # Three acting asks, one that is ready, then the answer: no prose was
    # written while choosing, and the answer ask could only write.
    assert kinds == ["act", "act", "act", "act", "answer"]
    assert all(x["body"]["temperature"] == 0.15 for x in fake_llm.seen[n:n + 4])
    assert fake_llm.seen[-1]["body"]["temperature"] == 0.4
    assert _schema(fake_llm.seen[n])["properties"]["calls"]["maxItems"] == 3


async def test_a_split_turn_keeps_one_thinking_setting(wp_client, fake_llm):
    # Switching thinking between the act and answer asks changes the head of
    # the prompt, and LM Studio read 15-18k tokens again (2026-10-22).
    for thinking, want in (("auto", "none"), ("high", "high")):
        _on(fake_llm, thinking=thinking)
        fake_llm.chat_steps.extend([
            {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "hair"})}]},
            {"message": "No hair yet.", "calls": []},
        ])
        n = len(fake_llm.seen)
        await _chat(wp_client, "find hair")
        asks = fake_llm.seen[n:]
        assert [_kind(x) for x in asks][-1] == "answer"
        assert {x["body"].get("reasoning_effort") for x in asks} == {want}


async def test_a_split_turn_out_of_steps_answers_instead_of_stopping(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend(
        [{"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": f"q{i}"})}]}
         for i in range(5)])
    fake_llm.chat_steps.append({"message": "Nothing fits; your library has no hair yet.",
                                "calls": []})
    body = await _chat(wp_client, "loop")
    # The last step can only write, so the turn ends on the model's answer,
    # not on "I kept looking".
    assert len([s for s in body["steps"] if not s.get("think")]) == 5
    assert body["message"] == "Nothing fits; your library has no hair yet."
    assert _kind(fake_llm.seen[-1]) == "answer"
    assert "No more tool calls" in fake_llm.seen[-1]["body"]["messages"][-1]["content"]


async def test_two_refusals_in_a_split_turn_make_it_answer(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": "aaaa9998"})}]},
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": "aaaa9999"})}]},
        {"message": "I couldn't find that item; which one did you mean?", "calls": []},
    ])
    body = await _chat(wp_client, "fix it")
    assert body["message"] == "I couldn't find that item; which one did you mean?"
    assert _kind(fake_llm.seen[-1]) == "answer" and not fake_llm.chat_steps


async def test_a_split_chat_still_acts_on_yes(wp_client, fake_llm):
    _on(fake_llm)
    asked = "I'll build a medieval pack. Should I proceed with creating these items?"
    fake_llm.chat_steps.extend([{"message": asked, "calls": []}] * 2)
    first = await _chat(wp_client, "build a medieval character pack")
    assert first["message"] == asked
    fake_llm.chat_steps.extend([
        {"message": asked, "calls": []},
        {"message": "", "calls": [{"tool": "plan_pack", "args": json.dumps(
            {"description": "Medieval fantasy character: hair, eyes, outfit, scene"})}]},
        {"message": "The Pack builder card is ready: press Plan it.", "calls": []},
    ])
    body = await _chat(wp_client, "yes", chat_id=first["chat_id"],
                       page={"route": "pack-builder"})
    assert body["message"] == "The Pack builder card is ready: press Plan it."
    assert body["proposals"][0]["op"]["kind"] == "pack"
    told = json.dumps([x["body"]["messages"][-1] for x in fake_llm.seen[-4:]])
    assert "proposing IS asking" in told


async def test_a_native_split_step_on_a_server_without_tool_choice(wp_client, fake_llm):
    """A server that only takes tool_choice "auto" is remembered: the act
    ask goes out as "auto" and its plain text is the answer."""
    _on(fake_llm, model="no-choice", tool_format="native")
    _ai_chat._NO_CHOICE.clear()
    fake_llm.chat_steps.append({"content": "Hello there."})
    out = await _chat(wp_client, "hi")
    assert out["format"] == "native" and out["message"] == "Hello there."
    assert fake_llm.seen[-2]["body"]["tool_choice"] == "required"  # refused
    assert fake_llm.seen[-1]["body"]["tool_choice"] == "auto"
    assert ("" + str(fake_llm.make_url("/v1")), "no-choice") in _ai_chat._NO_CHOICE
    n = len(fake_llm.seen)
    fake_llm.chat_steps.append({"content": "Again."})
    out = await _chat(wp_client, "again", chat_id=out["chat_id"])
    assert out["message"] == "Again." and len(fake_llm.seen) == n + 1
    _ai_chat._NO_CHOICE.clear()


async def test_a_native_answer_ask_never_runs_calls(wp_client, fake_llm):
    """A server that ignores tool_choice "none" can still send a call with
    the answer: the step was told to write, so only its text counts."""
    await _two_wildcards(wp_client)
    _on(fake_llm, model="tooly", tool_format="native")
    ready = {"id": "call_ready", "type": "function",
             "function": {"name": "answer", "arguments": "{}"}}
    search = {"id": "call_s", "type": "function",
              "function": {"name": "search", "arguments": json.dumps({"query": "hair"})}}
    fake_llm.chat_steps.extend([{"content": "", "tool_calls": [ready]},
                                {"content": "You have two wildcards.", "tool_calls": [search]}])
    out = await _chat(wp_client, "what do I have?")
    assert fake_llm.seen[-1]["body"]["tool_choice"] == "none"
    assert out["message"] == "You have two wildcards."
    assert not any(s.get("tool") == "search" for s in out["steps"])


async def test_web_tools_load_by_group_at_the_end_of_the_list(
        wp_client, fake_llm, searx):  # noqa: F811 - the fixture
    _on(fake_llm, model="tooly", tool_format="native")
    ai_config.update({"search_engine": "searxng",
                      "search_url": str(searx.make_url("")).rstrip("/")})
    fake_llm.chat_steps.extend([
        {"content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {
            "name": "more_tools", "arguments": json.dumps({"group": "web"})}}]},
        {"content": "", "tool_calls": [{"id": "c2", "type": "function", "function": {
            "name": "web_search", "arguments": json.dumps({"query": "plate armour"})}}]},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "look up plate armour")
    first, after = fake_llm.seen[n]["body"], fake_llm.seen[-1]["body"]
    names = [t["function"]["name"] for t in first["tools"]]
    later = [t["function"]["name"] for t in after["tools"]]
    # Not declared up front, though it is set up; the first message says how.
    assert "web_search" not in names and "more_tools" in names
    assert 'more_tools with {"group": "web"}' in first["messages"][-1]["content"]
    # Loaded at the end: everything sent before keeps its place.
    assert later[:len(names) - 1] == names[:-1]
    assert later[len(names) - 1:] == ["web_search", "read_result", "answer"]
    assert first["messages"][0] == after["messages"][0]  # the instructions never change
    [call] = body["pending"]
    assert call["tool"] == "web_search"


async def test_every_tool_keeps_web_search_on_the_next_message(
        wp_client, fake_llm, searx):  # noqa: F811 - the fixture
    """more_tools with no group loads web search too; the next request
    must not drop it again as an unloaded lazy group."""
    _on(fake_llm, model="tooly", tool_format="native")
    ai_config.update({"search_engine": "searxng",
                      "search_url": str(searx.make_url("")).rstrip("/")})
    fake_llm.chat_steps.extend([
        {"content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {
            "name": "more_tools", "arguments": "{}"}}]},
        {"content": "Ready."},
    ])
    first = await _chat(wp_client, "load everything")
    loaded = [t["function"]["name"] for t in fake_llm.seen[-1]["body"]["tools"]]
    assert "web_search" in loaded
    fake_llm.chat_steps.append({"content": "Still here."})
    await _chat(wp_client, "and now?", chat_id=first["chat_id"])
    assert [t["function"]["name"] for t in fake_llm.seen[-1]["body"]["tools"]] == loaded


async def test_more_tools_names_its_groups(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "more_tools", "args": {"group": "web"}},
                                  {"tool": "more_tools", "args": {"group": "combines"}},
                                  {"tool": "more_tools", "args": {"group": "combines"}}]},
        {"message": "Done.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "go ahead with it")
    results = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert "web search isn't set up" in results
    assert "create_combine" in results  # its prompt line, since the JSON prompt stays
    assert "already made this exact call" in results
    # The JSON instructions list only the starting tools, every request.
    assert len({x["body"]["messages"][0]["content"] for x in fake_llm.seen[n:]}) == 1
    act = _schema(fake_llm.seen[-2])["properties"]["calls"]["items"]
    assert "create_combine" in json.dumps(act)  # but the grammar takes it now


def test_the_message_words_name_the_groups_it_needs():
    from engine.ai import tools as ai_tools
    assert ai_tools.groups_for("make a fixed values preset") == ["fixed-values"]
    assert ai_tools.groups_for("retag my items and fix the categories") == ["lists"]
    assert ai_tools.groups_for("bundle these into a template") == ["templates", "bundles"]
    assert ai_tools.groups_for("hello there") == []


async def test_a_message_naming_a_kind_loads_its_tools(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Sure.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "make a combine of hair and eyes")
    act = next(_schema(x)["properties"]["calls"]["items"] for x in fake_llm.seen[n:]
               if "calls" in _schema(x)["properties"])
    assert "create_combine" in json.dumps(act)
    tail = fake_llm.seen[n]["body"]["messages"][-1]["content"]
    assert "create_combine" in tail


def test_more_adds_a_group_or_everything_at_the_end():
    from engine.ai import tools as ai_tools
    base = ai_tools.toolset("wildcards", scoped=True)
    names, added = ai_tools.more(base, "combines", lambda t: True)
    assert names[:len(base)] == base and [t.name for t in added] == [
        "create_combine", "edit_combine"]
    everything, _ = ai_tools.more(base, None, lambda t: t.kind != "web")
    assert everything[:len(base)] == base and "create_bundle" in everything
    assert "web_search" not in everything
    try:
        ai_tools.more(base, "nope", lambda t: True)
    except ValueError as e:
        assert "groups: wildcards" in str(e)
    else:
        raise AssertionError("an unknown group must be refused")


def test_open_takes_a_docs_page_id_given_as_an_item_id():
    class Lib:
        earlier_proposals: dict = {}
        _next_pid = 0
        _created: dict = {}

        def get(self, key):
            return None

        def _find(self, key):
            return None

    args, label = client_tools.prepare(Lib(), "open", {"id": "constraints"})
    assert args == {"doc": "constraints"} and label.startswith("Opened the docs: ")
    try:
        client_tools.prepare(Lib(), "open", {"id": "no-such-thing"})
    except ValueError as e:
        assert "no-such-thing" in str(e)
    else:
        raise AssertionError("an unknown id must be refused")


async def test_an_empty_answer_after_a_highlight_says_what_was_done(wp_client, fake_llm):
    """Browser check 2026-10-19: "Highlight the bundles" pointed at the
    right rows and then ended on "The model gave an empty answer"."""
    _on(fake_llm, model_size="large")
    page = {"route": "dashboard"}
    fake_llm.chat_steps.extend([{"message": "", "calls": [{"tool": "read_page", "args": "{}"}]}])
    first = await _chat(wp_client, "highlight the settings", page=page)
    assert first["pending"][0]["tool"] == "read_page"
    point = {"tool": "highlight", "args": '{"anchor": "settings", "caption": "Settings"}'}
    fake_llm.chat_steps.extend([{"message": "", "calls": [point]}])
    read = await _resume(wp_client, first["chat_id"],
                         [{"id": first["pending"][0]["id"], "text": "[settings] Settings"}],
                         page=page)
    assert read["pending"][0]["tool"] == "highlight"
    # The model has nothing to say after the highlight (twice: it is nudged once).
    fake_llm.chat_steps.extend([{"message": "", "calls": []}, {"message": "", "calls": []}])
    done = await _resume(wp_client, read["chat_id"],
                         [{"id": read["pending"][0]["id"], "text": "pointed"}], page=page)
    assert done["message"] == "It's highlighted on the page: Settings."
    assert done["pending"] == []


async def test_an_empty_answer_after_a_failed_highlight_gets_one_more_step(
        wp_client, fake_llm):
    """Sonnet and Haiku probes 2026-10-21: a highlight the page couldn't
    show, then an empty answer and "The model gave an empty answer"."""
    _on(fake_llm, model_size="large")
    page = {"route": "dashboard"}
    fake_llm.chat_steps.extend([{"message": "", "calls": [{"tool": "read_page", "args": "{}"}]}])
    first = await _chat(wp_client, "link me the weights guide", page=page)
    point = {"tool": "highlight", "args": '{"anchor": "weights", "caption": "Weights guide"}'}
    fake_llm.chat_steps.extend([{"message": "", "calls": [point]}])
    read = await _resume(wp_client, first["chat_id"],
                         [{"id": first["pending"][0]["id"], "text": "[weights] Weights"}],
                         page=page)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": []},
        {"message": "The Weights guide is under Docs, Wildcards.", "calls": []},
    ])
    n = len(fake_llm.seen)
    done = await _resume(wp_client, read["chat_id"],
                         [{"id": read["pending"][0]["id"], "text": "no part weights"}],
                         page=page)
    assert done["message"] == "The Weights guide is under Docs, Wildcards."
    nudge = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert ai_chat.PAGE_FAILED_NUDGE in nudge and len(fake_llm.seen) == n + 2
    # Empty again: the user is told the page call didn't work.
    fake_llm.chat_steps.extend([{"message": "", "calls": [point]}])
    again = await _chat(wp_client, "point at it again", chat_id=done["chat_id"], page=page)
    fake_llm.chat_steps.extend([{"message": "", "calls": []}, {"message": "", "calls": []}])
    last = await _resume(wp_client, again["chat_id"],
                         [{"id": again["pending"][0]["id"], "text": "no part weights"}],
                         page=page)
    assert last["message"].startswith("(That didn't work on your page")


async def test_an_empty_answer_on_the_last_step_gets_one_more_step(wp_client, fake_llm):
    _on(fake_llm, model_size="large")
    search = [{"tool": "search", "args": json.dumps({"query": f"q{n}"})}
              for n in range(ai_chat.MAX_STEPS - 1)]
    fake_llm.chat_steps.extend([
        *({"message": "", "calls": [c]} for c in search),
        {"message": "", "calls": []},
        {"message": "Nothing about hats yet.", "calls": []},
    ])
    out = await _chat(wp_client, "anything about hats?")
    assert out["message"] == "Nothing about hats yet."
    assert ai_chat.EMPTY_WORDS_NUDGE in fake_llm.seen[-1]["body"]["messages"][-1]["content"]


async def test_highlight_needs_a_read_page_on_this_page(wp_client, fake_llm):
    _on(fake_llm, model_size="large")
    point = {"tool": "highlight", "args": '{"anchor": "settings", "caption": "Settings"}'}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [point]},
        {"message": "", "calls": [{"tool": "read_page", "args": "{}"}]},
    ])
    page = {"route": "dashboard"}
    first = await _chat(wp_client, "where are the settings?", page=page)
    # Refused on the server, in one line, without a pause.
    assert first["steps"][0]["ok"] is False
    assert client_tools.READ_PAGE_FIRST in first["steps"][0]["note"]
    assert first["pending"][0]["tool"] == "read_page"
    fake_llm.chat_steps.extend([{"message": "", "calls": [point]}])
    read = await _resume(wp_client, first["chat_id"],
                         [{"id": first["pending"][0]["id"], "text": "[settings] Settings"}],
                         page=page)
    assert read["pending"][0]["tool"] == "highlight"
    await _resume(wp_client, first["chat_id"],
                  [{"id": read["pending"][0]["id"], "text": "pointed"}], page=page)
    # On another page, the anchors read before don't count.
    fake_llm.chat_steps.extend([{"message": "", "calls": [point]},
                                {"message": "Read the page first.", "calls": []}])
    other = await _chat(wp_client, "and here?", chat_id=first["chat_id"],
                        page={"route": "wildcards"})
    assert other["pending"] == [] and client_tools.READ_PAGE_FIRST in other["steps"][0]["note"]


async def test_connection_test_splits_the_fixed_prefix(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm, model="tooly", tool_format="native")
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    prefix = body["prefix"]
    parts = prefix["parts"]
    assert prefix["format"] == "native" and prefix["size"] == "medium" and prefix["split"]
    assert parts["tools"] > 0 and parts["library"] > 0 and parts["instructions"] > 0
    assert abs(sum(parts.values()) - prefix["tokens"]) <= 3 and prefix["fits"] is True
    _on(fake_llm, model="m1", tool_format="json")
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    assert body["prefix"]["parts"]["tools"] == 0  # listed inside the instructions


async def test_a_permission_in_a_lazy_json_chat_leaves_the_prompt_alone(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hello.", "calls": []})
    first = await _chat(wp_client, "hi")
    system = fake_llm.seen[-1]["body"]["messages"][0]["content"]
    ai_config.update({"allow_delete": True})
    fake_llm.chat_steps.append({"message": "Which items?", "calls": []})
    await _chat(wp_client, "delete stuff", chat_id=first["chat_id"])
    sent = fake_llm.seen[-1]["body"]["messages"]
    assert sent[0]["content"] == system and "- delete_items " not in system
    # How to call it goes with the message that says it is on.
    assert "- delete_items " in sent[-1]["content"] and "delete stuff" in sent[-1]["content"]
    assert ai_chat.GO_NUDGE not in sent[-1]["content"]
