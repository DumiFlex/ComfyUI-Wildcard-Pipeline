"""Renaming a variable to a name other items already set (9B smoke
s-rename-var, 2026-10-24): the clash warning keeps the asked-for name, and
a look-up repeated before any card gets one more step instead of a forced
answer."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat, _wildcard
from tests.wp_api.test_ai_chats import _on
from tests.wp_api.test_ai_plan_items import _offered
from tests.wp_api.test_ai_small_models import _kind

OPTS = [{"id": "cccc0001", "value": "red", "weight": 1, "sub_categories": []}]


async def _library(wp_client):
    await _wildcard(wp_client, "Hair color", "hair_color", OPTS, [])
    return await _wildcard(wp_client, "Hair", "hair", [
        {"id": "dddd0001", "value": "long hair", "weight": 1, "sub_categories": []}], [])


def _acts(seen):
    return [x for x in seen if "response_format" in x["body"] and _kind(x) == "act"]


def _told(seen):
    return " ".join(str(m["content"]) for m in seen["body"]["messages"][1:])


async def test_the_clash_warning_keeps_the_name_the_user_asked_for(wp_client, fake_llm):
    hair = await _library(wp_client)
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "edit_options", "args": json.dumps(
            {"id": hair, "var": "hair_color"})}]},
        {"message": "Proposed the rename.", "calls": []},
        {"message": "Proposed the rename.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "Rename the variable of [[" + hair + "#Hair]] to hair_color.")
    told = " ".join(_told(x) for x in fake_llm.seen[n:])
    assert "The user asked for $hair_color, so keep it" in told
    assert "pick another variable name" not in told


async def test_a_repeated_look_up_before_any_card_gets_one_more_step(wp_client, fake_llm):
    hair = await _library(wp_client)
    _on(fake_llm, model_size="small", tool_format="json")
    look = {"tool": "variables", "args": json.dumps({"var": "hair_color"})}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [look]},
        {"message": "", "calls": [look]},
        {"message": "", "calls": [{"tool": "edit_options", "args": json.dumps(
            {"id": hair, "var": "hair_color"})}]},
        {"message": "Proposed the rename.", "calls": []},
        {"message": "Proposed the rename.", "calls": []},
    ])
    n = len(fake_llm.seen)
    out = await _chat(wp_client, "Rename the variable of [[" + hair + "#Hair]] to hair_color.")
    assert [p["tool"] for p in out["proposals"]] == ["edit_options"]
    acts = _acts(fake_llm.seen[n:])
    assert "variables" in _offered(acts[1]) and "variables" not in _offered(acts[2])
    assert "variables is closed for the rest of this answer" in _told(acts[2])
    assert "No more tool calls" not in _told(acts[2])
