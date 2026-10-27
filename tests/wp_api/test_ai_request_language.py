"""Requests in another language get one request-frame call, and the code
checks read it (`engine/ai/lang.py`, research note 2026-10-27)."""
from __future__ import annotations

import json

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on
from tests.wp_api.test_ai_narrow_api import _acts
from tests.wp_api.test_ai_plan_items import _offered
from tests.wp_api.test_ai_prefix_stable import _on as _on_typed
from wp_api import _ai_lang

GERMAN = "Füge drei Wetteroptionen hinzu, jede mit Negativen"
FRAME = {"language": "de", "english": "Add three weather options, each with negatives",
         "kind": "change", "count": 3, "weight": "none", "factor": None,
         "wants": ["negatives"]}
WEATHER = {"name": "Weather", "var": "weather",
           "options": [{"text": "rain"}, {"text": "snow"}, {"text": "fog"}]}


def _frames(fake_llm, n=0):
    return [x for x in fake_llm.seen[n:] if (x["body"].get("response_format") or {})
            .get("json_schema", {}).get("name") == "request_frame"]


def _told(fake_llm, n):
    return " ".join(str(m["content"]) for x in fake_llm.seen[n:]
                    for m in x["body"]["messages"] if m["role"] == "user")


async def test_a_german_change_ask_keeps_its_change_tools(wp_client, fake_llm):
    # Without the frame "Füge drei Wetteroptionen hinzu" read as small talk
    # and the shortlist offered no change tool.
    _ai_lang._CACHE.clear()
    _on_typed(fake_llm)
    fake_llm.overrides["request_frame"] = FRAME
    fake_llm.chat_steps.append({"message": "Done.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "Füge drei Wetteroptionen hinzu")
    assert len(_frames(fake_llm, n)) == 1
    offered = _offered(_acts(fake_llm, n)[0])
    assert "create_wildcard" in offered and "react" not in offered


async def test_the_request_check_reads_the_frame(wp_client, fake_llm):
    _ai_lang._CACHE.clear()
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.overrides["request_frame"] = FRAME
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(WEATHER)}]},
        {"message": "Proposed Weather.", "calls": []},
        {"message": "Proposed Weather.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, GERMAN)
    told = _told(fake_llm, len(fake_llm.seen) - 1)
    assert told.count("check the cards against the request") == 1
    # The model reads the user's own words, never the restatement.
    assert f'The request: "{GERMAN}"' in told
    assert FRAME["english"] not in _told(fake_llm, n + 1)


async def test_english_asks_get_no_frame_unless_settings_say_so(wp_client, fake_llm):
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "Hi!", "calls": []}] * 3)
    n = len(fake_llm.seen)
    await _chat(wp_client, "make a weather wildcard please")
    assert not _frames(fake_llm, n)
    ai_config.update({"request_language": "english"})
    await _chat(wp_client, "Mach eine Wetter-Wildcard bitte")
    assert not _frames(fake_llm, n)
    ai_config.update({"request_language": "other"})
    fake_llm.overrides["request_frame"] = FRAME
    await _chat(wp_client, "make a weather wildcard please")
    assert len(_frames(fake_llm, n)) == 1


async def test_a_frame_is_asked_once_per_text(wp_client, fake_llm):
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    fake_llm.overrides["request_frame"] = FRAME
    fake_llm.chat_steps.extend([{"message": "Gern.", "calls": []}] * 2)
    n = len(fake_llm.seen)
    await _chat(wp_client, GERMAN)
    await _chat(wp_client, GERMAN)
    assert len(_frames(fake_llm, n)) == 1


async def test_an_unusable_frame_leaves_the_english_checks(wp_client, fake_llm):
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    fake_llm.overrides["request_frame"] = {"english": ""}
    fake_llm.chat_steps.append({"message": "Gern.", "calls": []})
    out = await _chat(wp_client, GERMAN)
    assert out["message"] == "Gern."
    assert not _ai_lang._CACHE


def _draft(instruction, **extra):
    return {"instruction": instruction, "count": 10, **extra,
            "wildcard": {"name": "Weather", "var_binding": "weather", "payload": {
                "options": [{"id": "a1", "value": "rain", "weight": 1}]}}}


async def test_the_draft_panel_takes_the_count_a_german_ask_names(wp_client, fake_llm):
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    fake_llm.overrides["request_frame"] = {**FRAME, "count": 6}
    fake_llm.overrides["wildcard_options"] = {"options": [
        {"text": t, "weight": 1, "tags": [], "negative": ""}
        for t in ("Sandsturm", "Hitze", "klarer Himmel", "Wind", "Dunst", "Gewitter")]}
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft(
        "Entwirf sechs Wüstenwetter-Optionen", count_auto=True))
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["count"] == 6
    # A count set by hand stays.
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft(
        "Entwirf sechs Wüstenwetter-Optionen"))
    assert (await resp.json())["count"] == 10


async def test_a_german_draft_keeps_the_negatives_it_asks_for(wp_client, fake_llm):
    # "mit Negativen" never matched the English check that keeps negatives,
    # so a German ask's negatives were stripped.
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    fake_llm.overrides["request_frame"] = {
        **FRAME, "english": "Add desert weather options with negatives", "count": None}
    fake_llm.overrides["wildcard_options"] = {"options": [
        {"text": "Sandsturm", "weight": 1, "tags": [], "negative": "Regen"}]}
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft(
        "Füge Wüstenwetter-Optionen mit Negativen hinzu"))
    assert resp.status == 200, await resp.text()
    [opt] = (await resp.json())["options"]
    assert opt["negative"] == "Regen"


async def test_the_setting_is_checked(wp_client, fake_llm):
    _on(fake_llm)
    resp = await wp_client.put("/wp/api/ai/config", json={"request_language": "klingon"})
    assert resp.status == 400
    resp = await wp_client.put("/wp/api/ai/config", json={"request_language": "other"})
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["request_language"] == "other"


async def test_a_german_say_so_lowers_a_rating(wp_client, fake_llm):
    # The safety guard's say-so check reads English words, so it reads the
    # restatement too.
    _ai_lang._CACHE.clear()
    _on(fake_llm)
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "Pose", "description": "", "category_id": None,
        "tags": ["nsfw"], "content_rating": "nsfw",
        "payload": {"var_binding": "pose", "sub_categories": [], "options": [
            {"id": "aaaa0001", "value": "sitting", "weight": 1, "sub_categories": []}]}})
    assert resp.status == 201, await resp.text()
    pose = (await resp.json())["id"]
    fake_llm.overrides["request_frame"] = {
        **FRAME, "english": "Pose is not nsfw, mark it safe", "count": None, "wants": []}
    call = {"tool": "update_info", "args": json.dumps({"id": pose, "rating": "safe"})}
    fake_llm.chat_steps.extend([{"message": "", "calls": [call]},
                                {"message": "Marked it safe.", "calls": []}])
    body = await _chat(wp_client, "Pose ist nicht jugendgefährdend, stuf es als harmlos ein")
    [card] = body["proposals"]
    assert card["op"]["body"]["content_rating"] == "safe"
