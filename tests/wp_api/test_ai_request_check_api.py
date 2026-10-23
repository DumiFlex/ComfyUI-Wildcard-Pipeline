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
    assert "No card in this answer has a fallback option" in out["message"]


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
