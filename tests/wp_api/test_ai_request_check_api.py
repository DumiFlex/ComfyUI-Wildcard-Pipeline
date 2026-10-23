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
