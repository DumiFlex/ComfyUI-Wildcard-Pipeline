"""/wp/api/ai/* against fake model servers for each wire format."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

from engine.ai import config as ai_config
from wp_api import _ai_client

ANSWER = {"options": [
    {"text": "silver hair", "weight": 1, "tags": ["cool"], "negative": ""},
    {"text": "red hair", "weight": 1, "tags": [], "negative": ""},  # duplicate
]}


@pytest.fixture(autouse=True)
def _isolated_ai(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    for var in ("WP_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
async def fake_llm(aiohttp_server):
    """One server speaking all three formats; records what it was sent."""
    seen: list[dict] = []

    async def openai_models(request):
        return web.json_response({"data": [{"id": "m1"}, {"id": "m2"}]})

    async def openai_chat(request):
        body = await request.json()
        seen.append({"path": request.path, "headers": dict(request.headers), "body": body})
        schema_name = body["response_format"]["json_schema"]["name"]
        content = {"ok": True} if schema_name == "probe" else ANSWER
        return web.json_response({"choices": [{"message": {"content": json.dumps(content)}}]})

    async def ollama_tags(request):
        return web.json_response({"models": [{"name": "qwen:9b"}]})

    async def ollama_chat(request):
        body = await request.json()
        seen.append({"path": request.path, "headers": dict(request.headers), "body": body})
        # Some models wrap JSON in a fence even with `format` set.
        fenced = "```json\n" + json.dumps(ANSWER) + "\n```"
        return web.json_response({"message": {"content": fenced}})

    async def anthropic_models(request):
        return web.json_response({"data": [{"id": "claude-x"}]})

    async def anthropic_messages(request):
        body = await request.json()
        seen.append({"path": request.path, "headers": dict(request.headers), "body": body})
        if request.headers.get("x-api-key") != "sk-ant":
            return web.json_response({"error": {"message": "invalid x-api-key"}}, status=401)
        return web.json_response({"content": [
            {"type": "text", "text": "Here you go"},
            {"type": "tool_use", "name": "submit", "input": ANSWER},
        ]})

    app = web.Application()
    app.router.add_get("/v1/models", openai_models)
    app.router.add_post("/v1/chat/completions", openai_chat)
    app.router.add_get("/api/tags", ollama_tags)
    app.router.add_post("/api/chat", ollama_chat)
    app.router.add_get("/anthropic/v1/models", anthropic_models)
    app.router.add_post("/anthropic/v1/messages", anthropic_messages)
    server = await aiohttp_server(app)
    server.seen = seen
    return server


def _draft_body():
    return {
        "instruction": "more hair colours", "count": 5,
        "wildcard": {"name": "hair", "var_binding": "hair", "payload": {
            "options": [{"id": "a1", "value": "red hair", "weight": 1}],
            "sub_categories": ["cool"],
        }},
    }


async def test_everything_but_config_is_off_by_default(wp_client):
    for path in ("/wp/api/ai/models", "/wp/api/ai/test", "/wp/api/ai/wildcard/draft"):
        resp = await wp_client.post(path, json=_draft_body())
        assert resp.status == 403, path
    resp = await wp_client.get("/wp/api/ai/config")
    assert resp.status == 200
    assert (await resp.json())["enabled"] is False


async def test_config_never_returns_the_key(wp_client):
    resp = await wp_client.put("/wp/api/ai/config", json={
        "enabled": True, "provider": "openai", "api_key": "sk-top-secret",
    })
    assert resp.status == 200
    text = await resp.text()
    assert "sk-top-secret" not in text
    assert json.loads(text)["key_set"] is True
    assert "sk-top-secret" not in await (await wp_client.get("/wp/api/ai/config")).text()


async def test_bad_config_is_400(wp_client):
    resp = await wp_client.put("/wp/api/ai/config", json={"base_url": "file:///etc"})
    assert resp.status == 400


async def test_openai_compatible_draft(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert [o["value"] for o in body["options"]] == ["silver hair"]
    assert body["skipped"] == [{"text": "red hair", "reason": "duplicate"}]
    sent = fake_llm.seen[-1]["body"]
    assert sent["model"] == "m1"
    assert sent["response_format"]["json_schema"]["strict"] is True
    assert sent["ttl"] == 60  # local server: unload after idle
    assert "red hair" in sent["messages"][1]["content"]


async def test_cloud_openai_omits_temperature_and_sends_bearer(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "openai", "api_key": "sk-o",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m2"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200
    seen = fake_llm.seen[-1]
    assert seen["headers"]["Authorization"] == "Bearer sk-o"
    assert "temperature" not in seen["body"]
    assert "ttl" not in seen["body"]


async def test_ollama_native_draft(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "ollama", "unload_after_s": 30,
                      "base_url": str(fake_llm.make_url("")), "model": "qwen:9b"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200, await resp.text()
    assert [o["value"] for o in (await resp.json())["options"]] == ["silver hair"]
    sent = fake_llm.seen[-1]["body"]
    assert sent["keep_alive"] == "30s"
    assert sent["format"]["required"] == ["options"]
    assert sent["stream"] is False


async def test_anthropic_draft_uses_forced_tool(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "anthropic", "api_key": "sk-ant",
                      "base_url": str(fake_llm.make_url("/anthropic")), "model": "claude-x"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200, await resp.text()
    assert [o["value"] for o in (await resp.json())["options"]] == ["silver hair"]
    sent = fake_llm.seen[-1]
    assert sent["body"]["tool_choice"] == {"type": "tool", "name": "submit"}
    assert sent["headers"]["anthropic-version"] == "2023-06-01"


async def test_upstream_auth_error_is_short_and_keyless(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "anthropic", "api_key": "wrong",
                      "base_url": str(fake_llm.make_url("/anthropic")), "model": "claude-x"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 502
    text = await resp.text()
    assert "refused the API key" in text
    assert "wrong" not in text


async def test_test_connection_reports_models_and_json(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "llamacpp",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m2"})
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    assert body["ok"] is True
    assert body["models"] == ["m1", "m2"]
    assert body["model_found"] is True
    assert body["json_ok"] is True
    assert isinstance(body["latency_ms"], int)


async def test_unreachable_server_is_a_clear_error(wp_client, unused_tcp_port):
    ai_config.update({"enabled": True, "provider": "custom",
                      "base_url": f"http://127.0.0.1:{unused_tcp_port}/v1", "model": "x"})
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    assert body["ok"] is False
    assert "couldn't connect" in body["error"]


async def test_draft_input_validation(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    assert (await wp_client.post("/wp/api/ai/wildcard/draft", json={})).status == 400
    bad = _draft_body() | {"count": "five"}
    assert (await wp_client.post("/wp/api/ai/wildcard/draft", json=bad)).status == 400
    huge = _draft_body() | {"instruction": "x" * 5000}
    assert (await wp_client.post("/wp/api/ai/wildcard/draft", json=huge)).status == 400


async def test_missing_model_is_400(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1"))})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 400
    assert "pick a model" in await resp.text()


def test_fence_and_chatty_json_are_recovered():
    assert _ai_client._parse_text_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _ai_client._parse_text_json('Sure! {"a": 2} hope that helps') == {"a": 2}
    with pytest.raises(_ai_client.AIError):
        _ai_client._parse_text_json("no json here")
