"""An answer whose cards miss a feature the request names gets one note
(harness research H1; smoke s-only, 2026-10-23)."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on

ASK = "make a weapon wildcard with a fallback option"
WEAPON = {"name": "Weapon", "var": "weapon",
          "options": [{"text": "sword"}, {"text": "bow"}]}


def _told(fake_llm, n):
    return " ".join(str(m["content"]) for x in fake_llm.seen[n:]
                    for m in x["body"]["messages"] if m["role"] == "user")


async def test_a_missing_feature_is_asked_for_once(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "Proposed Weapon.", "calls": []},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    out = await _chat(wp_client, ASK)
    told = _told(fake_llm, len(fake_llm.seen) - 1)  # the last ask carries the whole log
    assert told.count("check the cards against the request") == 1
    assert 'a fallback option' in told and f'The request: "{ASK}"' in told
    [card] = out["proposals"]
    assert any(o.get("fallback") for o in card["op"]["body"]["payload"]["options"])


async def test_cards_that_have_it_get_no_note(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [{"text": "sword"}, {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, ASK)
    assert "check the cards against the request" not in _told(fake_llm, n)


async def test_the_step_after_the_note_offers_only_the_fix(wp_client, fake_llm):
    # Smoke --empty: the 9B met the note with more_tools, then opened its
    # own card twice and claimed the fallback.
    from tests.wp_api.test_ai_narrow_api import _acts
    from tests.wp_api.test_ai_plan_items import _offered
    from tests.wp_api.test_ai_prefix_stable import _on as _on_typed

    _on_typed(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "Proposed Weapon.", "calls": []},
        {"message": "No fallback needed.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, ASK)
    acts = _acts(fake_llm, n)
    assert "more_tools" in _offered(acts[1])
    after = _offered(acts[2])
    assert set(after) == {"create_wildcard", "edit_options"}


async def test_an_answer_that_claims_the_missing_feature_is_marked(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "Proposed Weapon.", "calls": []},
        {"message": "Proposed Weapon with fists as the fallback.", "calls": []},
        {"message": "Proposed Weapon with fists as the fallback.", "calls": []},
    ])
    out = await _chat(wp_client, ASK)
    assert "You asked for a fallback option, but no card in this answer has it" \
        in out["message"]


async def test_a_forced_answer_still_gets_the_note(wp_client, fake_llm):
    # 9B smoke s-tag-filter: two refused opens force the answer, which
    # used to skip the note, so plain colours stood without the tag ref.
    _on(fake_llm, model_size="small", tool_format="json")
    sky = {"name": "Sky", "var": "", "options": [{"text": "crimson sky"}]}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(sky)}]},
        {"message": "", "calls": [{"tool": "open", "args": json.dumps({"proposal": "p1"})}]},
        {"message": "", "calls": [{"tool": "open", "args": json.dumps({"proposal": "p1"})}]},
        {"message": "Proposed Sky.", "calls": []},
        {"message": "Proposed Sky.", "calls": []},
        {"message": "Proposed Sky.", "calls": []},
    ])
    await _chat(wp_client, "Make a Sky wildcard whose options use only warm colours from Palette.")
    told = _told(fake_llm, len(fake_llm.seen) - 1)
    assert told.count("check the cards against the request") == 1


async def test_a_step_after_the_card_that_changes_nothing_gets_the_note(wp_client, fake_llm):
    # 9B smoke d25d274: card, more_tools, open, then the answer, and only
    # then the note. The note now comes with the first step that changes nothing.
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "", "calls": [{"tool": "more_tools", "args": json.dumps({"group": "web"})}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    out = await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert log.count("check the cards against the request") == 1
    assert log.index("check the cards against the request") < log.index("fists")
    [card] = out["proposals"]
    assert any(o.get("fallback") for o in card["op"]["body"]["payload"]["options"])


async def test_an_answer_on_the_last_step_still_gets_the_note(wp_client, fake_llm, monkeypatch):
    # 9B smoke d25d274 full library: the answer came on the last step, so
    # the note had no step left for the fix and never ran.
    from engine.ai import chat as ai_chat
    monkeypatch.setattr(ai_chat, "MAX_STEPS", 2)
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "Proposed Weapon.", "calls": []},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    out = await _chat(wp_client, ASK)
    [card] = out["proposals"]
    assert any(o.get("fallback") for o in card["op"]["body"]["payload"]["options"])
    assert "ran out of steps" not in out["message"]


async def test_the_same_card_after_the_note_is_told_what_it_lacks(wp_client, fake_llm):
    # 9B smoke s-tag-filter: three runs answered the note with the same card.
    _on(fake_llm, model_size="small", tool_format="json")
    same = {"tool": "create_wildcard", "args": json.dumps(WEAPON)}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [same]},
        {"message": "", "calls": [{"tool": "more_tools", "args": json.dumps({"group": "web"})}]},
        {"message": "", "calls": [same]},
        {"message": "Proposed Weapon.", "calls": []},
    ])
    await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert "It still lacks a fallback option" in log
    [tail] = [str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"]
              if "check the cards against" in str(m["content"])]
    assert "don't propose these again" not in tail


async def test_a_repeat_before_any_note_gets_the_check(wp_client, fake_llm):
    # 9B smoke 234bce5 full s42: the same card twice, then constraints;
    # the note came only at the answer, with create_wildcard closed.
    _on(fake_llm, model_size="small", tool_format="json")
    same = {"tool": "create_wildcard", "args": json.dumps(WEAPON)}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [same]},
        {"message": "", "calls": [same]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    out = await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert "It still lacks a fallback option" in log
    assert "check the cards against the request" not in log
    assert any(o.get("fallback") for p in out["proposals"]
               for o in p["op"]["body"]["payload"]["options"])


async def test_a_repeat_of_a_card_that_has_it_gets_the_plain_refusal(wp_client, fake_llm):
    # 234bce5 empty s42: the fixed card sent again was told it lacked the ref.
    _on(fake_llm, model_size="small", tool_format="json")
    fixed = {"tool": "create_wildcard", "args": json.dumps(
        {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [fixed]},
        {"message": "", "calls": [fixed]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert "still lacks" not in log and "you already proposed exactly this" in log


async def test_a_card_that_drops_the_asked_feature_is_told(wp_client, fake_llm):
    # 9B smoke e760fd2 empty s42: the fixed Sky card rewritten back to
    # plain colours to get rid of a duplicate warning.
    _on(fake_llm, model_size="small", tool_format="json")
    good = {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]}
    bad = {**WEAPON, "options": [*WEAPON["options"], {"text": "fists"}]}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(good)}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(bad)}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(good)}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert log.count("This card drops a fallback option") == 1


async def test_a_card_resent_with_only_its_tags_changed_still_lacks_it(wp_client, fake_llm):
    # 9B smoke e760fd2 full s7: Sky re-sent with a category, then with its
    # option tags flipped, each accepted, never with the ref.
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "category": "Props"})}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(
            {**WEAPON, "options": [*WEAPON["options"], {"text": "fists", "fallback": True}]})}]},
        {"message": "Proposed Weapon with a fallback.", "calls": []},
    ])
    await _chat(wp_client, ASK)
    log = " ".join(str(m["content"]) for m in fake_llm.seen[-1]["body"]["messages"])
    assert "It still lacks a fallback option" in log
    assert "check the cards against the request" not in log


async def test_claims_the_cards_do_not_back_are_marked(wp_client, fake_llm):
    # Bench B3 / W13 / C5: "created successfully" before Apply, a weight no
    # card sets, and a tool name in the reply.
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEAPON)}]},
        *[{"message": "Weapon has been created successfully with the create_wildcard tool; "
                      "bow is at weight 0.5.", "calls": []}] * 4,
    ])
    out = await _chat(wp_client, "make a weapon wildcard, bows rare")
    msg = out["message"]
    assert "Nothing has changed yet" in msg
    assert "names a weight or factor (0.5) that no card sets" in msg
    assert "create_wildcard" not in msg and "a new wildcard" in msg
