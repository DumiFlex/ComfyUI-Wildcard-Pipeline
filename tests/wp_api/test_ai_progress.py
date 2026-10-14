"""wp_api/_ai_progress.py — what a plain AI request is doing while it runs."""
from __future__ import annotations

from tests.wp_api.test_ai_chats import _cfg, _sse, streamer  # noqa: F401
from wp_api import _ai_chat, _ai_client, _ai_progress

_SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}}


async def test_complete_json_streams_and_records_phases_when_watched(streamer):  # noqa: F811
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse(
        {"choices": [{"delta": {"reasoning_content": "hmm"}}]},
        {"choices": [{"delta": {"content": '{"ok": tr'}}]},
        {"choices": [{"delta": {"content": "ue}"}, "finish_reason": "stop"}]},
    )
    seen: list = []
    real = _ai_progress.on_event

    async def spy(ev):
        await real(ev)
        seen.append(_ai_progress.view("watched-1")["phase"])

    _ai_progress.begin("watched-1")
    token = _ai_progress.current.set("watched-1")
    _ai_progress.on_event = spy
    try:
        answer = await _ai_client.complete_json(
            _cfg(streamer), system="s", user="u", schema=_SCHEMA, schema_name="t")
    finally:
        _ai_progress.on_event = real
        _ai_progress.current.reset(token)
    assert answer == {"ok": True}
    assert streamer.state["seen"][0]["stream"] is True
    assert seen[0] == "thinking" and seen[-1] == "writing"
    view = _ai_progress.view("watched-1")
    assert view["calls"] == 1 and view["tokens"] == len('{"ok": true}') // 4
    _ai_progress.finish("watched-1")
    assert _ai_progress.view("watched-1")["done"] is True


async def test_complete_json_stays_plain_when_nobody_watches(streamer):  # noqa: F811
    _ai_chat._NO_STREAM.clear()
    streamer.state["plain"] = {"choices": [{"message": {"content": '{"ok": true}'},
                                            "finish_reason": "stop"}]}
    answer = await _ai_client.complete_json(
        _cfg(streamer), system="s", user="u", schema=_SCHEMA, schema_name="t")
    assert answer == {"ok": True}
    assert "stream" not in streamer.state["seen"][0]


async def test_thinking_off_reaches_the_draft_panels_too(streamer):  # noqa: F811
    streamer.state["plain"] = {"choices": [{"message": {"content": '{"ok": true}'}}]}
    cfg = {**_cfg(streamer), "provider": "lmstudio", "local": True, "thinking": "off"}
    await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA, schema_name="t")
    assert streamer.state["seen"][0]["reasoning_effort"] == "none"


def test_ids_are_checked_and_old_entries_dropped():
    assert not _ai_progress.valid("../etc") and not _ai_progress.valid("short")
    assert _ai_progress.valid("abcDEF12-_x")
    for i in range(_ai_progress._KEEP + 5):
        _ai_progress.begin(f"many-ids-{i:04d}")
    assert len(_ai_progress._entries) <= _ai_progress._KEEP
    assert _ai_progress.view("many-ids-0000") is None


async def test_the_progress_route(wp_client):
    resp = await wp_client.get("/wp/api/ai/progress/not-a-real-id")
    assert resp.status == 404
    await wp_client.get("/wp/api/ai/vision", headers={"X-WP-Progress": "route-check-1"})
    resp = await wp_client.get("/wp/api/ai/progress/route-check-1")
    assert resp.status == 200
    assert (await resp.json())["done"] is True
