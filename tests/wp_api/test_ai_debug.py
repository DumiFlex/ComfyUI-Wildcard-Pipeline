"""The AI debug log through the routes: what a request with X-WP-Debug records."""
from __future__ import annotations

import pytest

from engine.ai import config as ai_config
from engine.ai import debug_log
from tests.wp_api._ai_fakes import ANSWER  # noqa: F401 - shared fakes


@pytest.fixture(autouse=True)
def _empty(monkeypatch, tmp_path):
    debug_log.clear()
    monkeypatch.delenv("WP_AI_DEBUG", raising=False)
    monkeypatch.setattr("wp_api._ai_debug.folder", lambda: tmp_path / "ai-debug")
    yield
    debug_log.clear()


def _draft_body():
    return {
        "instruction": "more hair colours", "count": 5,
        "wildcard": {"name": "hair", "var_binding": "hair", "payload": {
            "options": [{"id": "a1", "value": "red hair", "weight": 1}],
            "sub_categories": ["cool"],
        }},
    }


async def _on(fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})


async def test_nothing_is_recorded_without_the_header(wp_client, fake_llm):
    await _on(fake_llm)
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200
    assert (await (await wp_client.get("/wp/api/ai/debug")).json())["records"] == []


async def test_a_draft_records_its_model_call(wp_client, fake_llm, tmp_path):
    await _on(fake_llm)
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body(),
                                headers={"X-WP-Debug": "dbg00001"})
    assert resp.status == 200
    [row] = (await (await wp_client.get("/wp/api/ai/debug")).json())["records"]
    assert row["id"] == "dbg00001" and row["label"] == "Draft: wildcard options"
    assert row["calls"] >= 1 and row["status"] == 200
    rec = await (await wp_client.get("/wp/api/ai/debug/dbg00001")).json()
    call = rec["calls"][0]
    assert call["path"].endswith("/chat/completions") and call["model"] == "m1"
    assert call["request"]["messages"] and call["response"]["choices"]
    assert rec["asked"] == "more hair colours"
    md = await (await wp_client.get("/wp/api/ai/debug/dbg00001?format=md")).text()
    assert "# AI debug: Draft: wildcard options" in md and "more hair colours" in md
    assert "silver hair" in md  # the model's answer
    assert list((tmp_path / "ai-debug").glob("*-dbg00001.json"))


async def test_a_chat_records_every_step(wp_client, fake_llm):
    await _on(fake_llm)
    resp = await wp_client.post("/wp/api/ai/chat", json={"message": "hello"},
                                headers={"X-WP-Debug": "chat0001"})
    assert resp.status == 200
    rec = await (await wp_client.get("/wp/api/ai/debug/chat0001")).json()
    assert rec["label"] == "Chat message" and rec["asked"] == "hello"
    assert rec["calls"] and all(c["path"].endswith("/chat/completions") for c in rec["calls"])
    assert any("hello" in str(c["request"]) for c in rec["calls"])


async def test_a_failed_call_records_the_error(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/nowhere")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body(),
                                headers={"X-WP-Debug": "fail0001"})
    assert resp.status >= 400
    rec = await (await wp_client.get("/wp/api/ai/debug/fail0001")).json()
    assert rec["error"] and rec["status"] == resp.status
    assert rec["calls"] and rec["calls"][0]["error"]


async def test_env_records_without_a_header(wp_client, fake_llm, monkeypatch):
    monkeypatch.setenv("WP_AI_DEBUG", "1")
    await _on(fake_llm)
    await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert len((await (await wp_client.get("/wp/api/ai/debug")).json())["records"]) == 1


async def test_unknown_id_is_404_and_clear_empties(wp_client, fake_llm):
    await _on(fake_llm)
    assert (await wp_client.get("/wp/api/ai/debug/nope00000")).status == 404
    await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body(),
                         headers={"X-WP-Debug": "dbg00002"})
    assert (await wp_client.delete("/wp/api/ai/debug")).status == 200
    assert (await (await wp_client.get("/wp/api/ai/debug")).json())["records"] == []
