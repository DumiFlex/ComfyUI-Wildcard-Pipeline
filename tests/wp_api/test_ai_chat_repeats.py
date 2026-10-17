"""A card proposed again in the same answer replaces the first: the user
gets one card (Dumi's 9B log: Model Style Tags four times)."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on

STYLE = {"name": "Model Style Tags", "var": "model_style",
         "options": [{"text": "cinematic lighting"}, {"text": "anime shading"}]}


async def test_a_repeated_card_in_one_answer_is_shown_once(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "create_constraint", "args": json.dumps({
            "source_id": "Model Style Tags", "target_id": "Model Style Tags", "rules": []})},
            {"tool": "create_wildcard", "args": json.dumps(
                {**STYLE, "options": [*STYLE["options"], {"text": "noir"}]})}]},
        {"message": "Proposed Model Style Tags.", "calls": []},
    ])
    out = await _chat(wp_client, "What could I add to my library?")
    cards = [p for p in out["proposals"] if p["tool"] == "create_wildcard"]
    assert len(cards) == 1 and cards[0]["pid"] == "p2" and "replaces" not in cards[0]
    assert len(cards[0]["op"]["body"]["payload"]["options"]) == 3


async def test_opening_its_own_card_is_no_error_and_an_untested_claim_is_marked(
        wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "open", "args": json.dumps({"proposal": "p1"})}]},
        {"message": "I ran a test and every option came up.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a style wildcard and test it.")
    assert all(s["ok"] for s in out["steps"]) and not out["pending"]
    assert "No test ran in this answer" in out["message"]


async def test_a_failed_change_sent_again_is_not_run_again(wp_client, fake_llm):
    _on(fake_llm)
    bad = json.dumps({"name": "Bad", "var": "not a name", "options": [{"text": "x"}]})
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": bad}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": bad}]},
        {"message": "That didn't work.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a wildcard.")
    results = json.dumps(fake_llm.seen[-1]["body"]["messages"][-1]["content"])
    assert "already made this exact call and it failed" in results
    assert [s["ok"] for s in out["steps"] if s["tool"] == "create_wildcard"] == [False]
