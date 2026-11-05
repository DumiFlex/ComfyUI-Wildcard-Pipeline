"""A tool the model keeps repeating leaves the grammar for the rest of the
answer (harness research H2; the 9B re-proposed one Setting card four
times in smoke s-only, 2026-10-23)."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on
from tests.wp_api.test_ai_plan_items import _offered
from tests.wp_api.test_ai_small_models import _kind

SETTING = {"name": "Setting", "var": "setting",
           "options": [{"text": "beach"}, {"text": "office"}]}


def _version(*extra):
    return {"tool": "create_wildcard", "args": json.dumps(
        {**SETTING, "options": [*SETTING["options"], *({"text": e} for e in extra)]})}


async def test_a_card_rewritten_twice_closes_its_tool(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [_version()]},
        {"message": "", "calls": [_version("forest")]},
        {"message": "", "calls": [_version("forest", "city")]},
        {"message": "Proposed Setting.", "calls": []},
    ])
    n = len(fake_llm.seen)
    out = await _chat(wp_client, "make a setting wildcard")
    assert [p["tool"] for p in out["proposals"]] == ["create_wildcard"]
    acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
            and _kind(x) == "act"]
    assert "create_wildcard" in _offered(acts[0])
    assert "create_wildcard" not in _offered(acts[-1])
    told = " ".join(str(m["content"]) for m in acts[-1]["body"]["messages"])
    assert "create_wildcard is closed for the rest of this answer" in told


async def test_one_rewrite_keeps_the_tool(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [_version()]},
        {"message": "", "calls": [_version("forest")]},
        {"message": "Proposed Setting.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "make a setting wildcard")
    acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
            and _kind(x) == "act"]
    assert "create_wildcard" in _offered(acts[-1])


async def test_opening_its_own_card_closes_open(wp_client, fake_llm):
    # 9B smoke 1a63959: open, open on its own card before each fix.
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [_version()]},
        {"message": "", "calls": [{"tool": "open", "args": json.dumps({"proposal": "p1"})}]},
        {"message": "Proposed Setting.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "make a setting wildcard and open it")
    acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
            and _kind(x) == "act"]
    assert "open" in _offered(acts[1])
    assert "open" not in _offered(acts[-1])
    told = " ".join(str(m["content"]) for m in acts[-1]["body"]["messages"])
    assert "open is closed for the rest of this answer" in told


async def test_after_a_claim_nudge_only_change_tools_are_offered(wp_client, fake_llm):
    # 9B smoke s-negatives (empty library): read, read, "I've proposed
    # adding negatives…" with no call, then the same claim after the nudge.
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "I've proposed a Setting wildcard with beach and office.", "calls": []},
        {"message": "", "calls": [_version()]},
        {"message": "Proposed Setting.", "calls": []},
    ])
    n = len(fake_llm.seen)
    out = await _chat(wp_client, "make a setting wildcard")
    assert [p["tool"] for p in out["proposals"]] == ["create_wildcard"]
    acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
            and _kind(x) == "act"]
    assert "search" in _offered(acts[0])
    after = _offered(acts[1])
    assert "create_wildcard" in after and "search" not in after and "read" not in after
