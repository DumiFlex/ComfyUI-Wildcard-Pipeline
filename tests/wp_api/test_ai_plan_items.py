"""Small models' tool steps: a shortlist of tools per message, and an ask
for several items planned once and made one item per step
(`engine/ai/plan_items.py`; research note "Small model tool use", T1/T2)."""
from __future__ import annotations

import json

from engine.ai import docs, examples, recipes
from engine.ai import plan_items as plan
from engine.ai import tools as ai_tools
from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_small_models import _kind, _on, _schema


def _offered(seen):
    """Tool names an act ask's grammar allows."""
    items = _schema(seen)["properties"]["calls"]["items"]
    if "anyOf" in items:
        return [o["properties"]["tool"]["enum"][0] for o in items["anyOf"]]
    return items["properties"]["tool"]["enum"]


def test_multi_item_asks_are_counted():
    assert plan.multi_ask("make 5 wildcards for a city") == 5
    assert plan.multi_ask("make me three derivations") == 3
    assert plan.multi_ask("create wildcards for hair, eyes, outfit and pose") == 4
    assert plan.multi_ask("I want two fixed values and a template") == 3
    assert plan.multi_ask("make a wildcard and a constraint") == 2
    assert plan.multi_ask("make 20 wildcards") == plan.MAX_ITEMS
    for one in ("make a weather wildcard", "add 50 options to the weather wildcard",
                "make 50 options for a wildcard", "explain wildcards and derivations",
                "make me a city pack", "edit the wildcard and run a test", ""):
        assert plan.multi_ask(one) == 0, one


def test_the_queue_makes_one_item_per_step_and_skips_a_stuck_one():
    q = plan.ItemQueue.from_args({"items": [
        {"tool": "create_wildcard", "name": "Hair", "about": "colors"},
        {"tool": "create_wildcard", "name": "hair", "about": "again"},  # a repeat
        {"tool": "delete_items", "name": "Old", "about": ""},  # not an item tool
        {"tool": "create_wildcard", "name": "Eyes", "about": ""},
    ]}, ["create_wildcard", "read", "delete_items"])
    assert q is not None and [i["name"] for i in q.items] == ["Hair", "Eyes"]
    assert q.allowed() == ["create_wildcard", "read", "search", "variables"]
    assert 'Plan item 1 of 2: create_wildcard "Hair": colors' in q.note()
    q.after_step(True)
    assert "Done: Hair." in q.note() and "It is the last one." in q.note()
    for _ in range(plan.MAX_TRIES):
        q.after_step(False)
    assert not q.active and q.skipped == ["Eyes"]
    assert "Not made: Eyes" in q.note() and "Answer the user now" in q.note()
    assert plan.ItemQueue.from_args({"items": [{"tool": "nope", "name": "x"}]}, ["nope"]) is None


def test_the_plan_tool_offers_the_chats_item_tools():
    t = plan.plan_tool(["search", "create_wildcard", "create_constraint", "plan_pack"], 3)
    items = t.params["properties"]["items"]
    assert items["maxItems"] == 3 and items["minItems"] == 1
    assert items["items"]["properties"]["tool"]["enum"] == ["create_wildcard",
                                                           "create_constraint"]


def test_a_shortlist_keeps_the_core_the_asked_groups_and_more_tools():
    names = ai_tools.toolset("wildcards", scoped=True)
    short = ai_tools.shortlist(names, "add rain to my weather options", "wildcards")
    assert short is not None and len(short) < len(names)
    assert {"search", "read", "more_tools", "add_options", "edit_options"} <= set(short)
    assert "edit_categories" not in short and "read_page" not in short
    page = ai_tools.shortlist(names, "where is the reach setting on this page?", "wildcards")
    assert {"read_page", "highlight", "open"} <= set(page or [])
    assert "plan_pack" in (ai_tools.shortlist(names, "build me a city pack", "fixed-values")
                           or [])
    assert ai_tools.shortlist(names, "", "wildcards") is None


async def test_several_items_are_planned_then_made_one_per_step(wp_client, fake_llm):
    _on(fake_llm)
    def make(name):
        return {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {"name": name, "var": name.lower(), "options": [{"text": "a"}, {"text": "b"}]})}]}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "plan_items", "args": json.dumps({"items": [
            {"tool": "create_wildcard", "name": n, "about": f"{n.lower()} picks"}
            for n in ("Hair", "Eyes", "Pose")]})}]},
        make("Hair"), make("Eyes"), make("Pose"),
        {"message": "", "calls": [{"tool": "run_test", "args": json.dumps(
            {"stack": ["Hair", "Eyes", "Pose"], "proposed": True})}]},
        {"message": "I proposed Hair, Eyes and Pose.", "calls": []},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "make 3 wildcards: hair, eyes and pose")
    asks = fake_llm.seen[n:]
    assert "plan_items" in asks[0]["body"]["messages"][-1]["content"]  # the hint
    assert _offered(asks[0]) == ["plan_items"]
    assert _schema(asks[0])["properties"]["calls"]["minItems"] == 1
    # Each item's step offers only its tool and the reads, and must call.
    for i in (1, 2, 3):
        assert _offered(asks[i]) == ["create_wildcard", "read", "search", "variables"]
        assert _schema(asks[i])["properties"]["calls"]["minItems"] == 1
    assert 'Plan item 2 of 3: create_wildcard "Eyes"' in asks[2]["body"]["messages"][-1][
        "content"]
    assert "Your plan is finished. Done: Hair, Eyes, Pose." in asks[4]["body"]["messages"][-1][
        "content"]
    assert [p["title"] for p in body["proposals"]] and len(body["proposals"]) == 3
    assert body["steps"][0]["note"].startswith("Planned Hair, Eyes, Pose")
    assert body["message"] == "I proposed Hair, Eyes and Pose."
    assert _kind(asks[-1]) == "answer"


async def test_a_shortlist_turn_widens_after_more_tools(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "more_tools", "args": json.dumps({})}]},
        {"message": "", "calls": []},
        {"message": "Your library is empty.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "what's in my library?")
    first, second = fake_llm.seen[n], fake_llm.seen[n + 1]
    assert "more_tools" in _offered(first) and "create_template" not in _offered(first)
    assert len(_offered(second)) > len(_offered(first))


def test_examples_pick_the_closest_calls_the_chat_can_make(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    tools = ["search", "read", "create_wildcard", "add_options"]
    got = examples.pick("make a hair wildcard", tools)
    assert got and got[0]["tool"] == "create_wildcard"
    assert all(e["tool"] in tools for e in got)
    assert examples.pick("and how many options?", tools) == []
    examples.remember([{"ask": "make a hair color wildcard", "tool": "create_wildcard",
                        "args": {"name": "Hair", "options": [{"text": f"o{i}"}
                                                             for i in range(9)]}}])
    kept = examples.load()
    assert len(kept[0]["args"]["options"]) == 3  # cut to a few
    assert examples.pick("make a hair wildcard", tools)[0]["ask"] == "make a hair color wildcard"
    assert 'make a hair color wildcard" → create_wildcard {' in examples.note(kept)


async def test_an_applied_card_becomes_an_example(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {"name": "Mood", "var": "mood", "options": [{"text": "calm"}, {"text": "tense"}]})}]},
        {"message": "", "calls": [{"tool": "run_test", "args": json.dumps(
            {"stack": ["Mood"], "proposed": True})}]},
        {"message": "Proposed Mood.", "calls": []},
    ])
    out = await _chat(wp_client, "make me a mood wildcard for portraits")
    pid = out["proposals"][0]["pid"]
    r = await wp_client.patch(f"/wp/api/ai/chats/{out['chat_id']}",
                              json={"events": [{"pid": pid, "status": "applied"}]})
    assert r.status == 200
    assert examples.load()[-1]["ask"] == "make me a mood wildcard for portraits"
    fake_llm.chat_steps.append({"message": "Sure.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "make a portrait lighting wildcard")
    asked = fake_llm.seen[n]["body"]["messages"][-1]["content"]
    assert "Calls that worked for similar requests" in asked
    assert '"make me a mood wildcard for portraits" → create_wildcard' in asked


async def test_later_split_steps_say_what_the_answer_did(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "x"})}]},
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "y"})}]},
        {"message": "Nothing.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "look for x and y")
    later = fake_llm.seen[n + 2]["body"]["messages"][-1]["content"]
    assert "So far in this answer you looked at" in later


def test_a_recipe_fits_the_ask():
    assert "run_test" in recipes.recipe("why do I never get red hair?")
    assert "edit_options" in recipes.recipe("make rain rarer")
    assert "explain" in recipes.recipe("how do constraints work")
    assert recipes.recipe("make a hair wildcard") == ""


def test_explain_reads_the_best_docs_section():
    out = docs.explain("constraint target reach")
    assert out.startswith("Docs › ") and "Link it in your answer" in out
    assert "no docs section matches" in docs.explain("zzqx")


async def test_choose_first_names_the_tool_then_fills_only_its_args(wp_client, fake_llm):
    _on(fake_llm, choose_first=True)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "hair"})}]},
        {"message": "You have no hair items.", "calls": []},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "what do I have for hair?")
    asks = fake_llm.seen[n:]
    first = _schema(asks[0])["properties"]
    assert "tool" in first and "answer" in first["tool"]["enum"]
    assert _offered(asks[1]) == ["search"]  # the fill ask: that tool only
    assert body["message"] == "You have no hair items."


def test_a_struggling_local_answer_offers_a_cloud_model_once():
    from wp_api import _ai_turn
    assert _ai_turn._struggled("I ran out of steps before finishing; ask me to continue.",
                               {}, None)
    assert _ai_turn._struggled("Done.", {"create_wildcard": 3}, None)
    assert not _ai_turn._struggled("Here you go.", {"read": 1}, None)


async def test_cloud_offer_names_a_provider_with_a_key(wp_client, fake_llm):
    from engine.ai import config as ai_config
    ai_config.update({"provider": "anthropic", "api_key": "sk-ant-test"})
    assert ai_config.cloud_ready() == ["Claude"]
    _on(fake_llm)
    fake_llm.chat_steps.extend(
        [{"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": f"q{i}"})}]}
         for i in range(5)])
    fake_llm.chat_steps.append({"message": "", "calls": []})
    fake_llm.chat_steps.append({"message": "", "calls": []})
    body = await _chat(wp_client, "loop")
    assert "You have Claude set up" in body["message"]


async def test_test_connection_tries_a_small_model_tool_step(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append(
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "hair"})}]})
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    assert body["tool_steps"] == {"typed": True, "picked": True, "error": None}
    probe = fake_llm.seen[-1]["body"]
    assert probe["reasoning_effort"] == "none"  # thinking off, as a chat's act ask
