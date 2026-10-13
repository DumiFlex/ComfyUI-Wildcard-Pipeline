"""Fake model servers and isolation shared by the AI route tests (loaded
as fixtures from conftest.py)."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

ANSWER = {"options": [
    {"text": "silver hair", "weight": 1, "tags": ["cool"], "negative": ""},
    {"text": "red hair", "weight": 1, "tags": [], "negative": ""},  # duplicate
]}


EDIT_ANSWERS = {
    "wildcard_remove": {"remove": [{"id": "2", "reason": "modern"}, {"id": "99", "reason": "?"}]},
    "wildcard_rewrite": {"options": [{"id": "1", "text": "a long red cloak"}]},
    "derivation_rules": {"rules": [{
        "summary": "Mages get a title",
        "branches": [{"match": "all",
                      "conditions": [{"var": "$class", "op": "equals", "value": "MAGE"}],
                      "actions": [{"target_var": "title", "mode": "replace",
                                   "value": "Archmage"}]}],
        "else_actions": [],
    }]},
    "describe": {"description": "Fantasy classes.", "tags": ["rpg", "Portrait"]},
    "organize": {"items": [
        {"id": "1", "category": "Characters", "tags_add": ["rpg"], "tags_remove": [],
         "rating": "keep", "reason": "classes"},
        {"id": "2", "category": "Gear", "tags_add": [], "tags_remove": [], "rating": "nsfw",
         "reason": "?"},
    ]},
    "constraint_rules": {"rules": [
        {"source": "#magic", "target": "#blade", "effect": "exclude", "factor": 0,
         "reason": "no swords"},
        {"source": "S1", "target": "T1", "effect": "boost", "factor": 3, "reason": "classic"},
    ]},
}


@pytest.fixture(autouse=True)
def _isolated_ai(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    for var in ("WP_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
async def fake_llm(aiohttp_server):
    """One server speaking all three formats; records what it was sent."""
    seen: list[dict] = []
    chat_steps: list[dict] = []
    overrides: dict[str, dict] = {}

    async def openai_models(request):
        return web.json_response({"data": [{"id": "m1"}, {"id": "m2"}]})

    async def openai_chat(request):
        body = await request.json()
        seen.append({"path": request.path, "headers": dict(request.headers), "body": body})
        if "tools" in body and body.get("model") == "refuser":
            return web.json_response({"error": {"message": "this model has no tool support"}},
                                     status=400)
        if "tools" in body:
            step = chat_steps.pop(0) if chat_steps else {"content": "Done."}
            return web.json_response({"choices": [{"message": {"role": "assistant", **step}}],
                                      "usage": {"prompt_tokens": 900, "completion_tokens": 20,
                                                "prompt_tokens_details": {"cached_tokens": 800}}})
        schema_name = body["response_format"]["json_schema"]["name"]
        content = {"ok": True} if schema_name == "probe" else EDIT_ANSWERS.get(schema_name, ANSWER)
        if schema_name in overrides:
            content = overrides[schema_name]
        if schema_name == "chat_step":
            content = chat_steps.pop(0) if chat_steps else {"message": "Done.", "calls": []}
        text = content if isinstance(content, str) else json.dumps(content)
        return web.json_response({"choices": [{"message": {"content": text}}]})

    async def lmstudio_model(request):
        caps = ["tool_use"] if request.match_info["mid"] == "tooly" else []
        return web.json_response({"id": request.match_info["mid"], "loaded_context_length": 4096,
                                  "capabilities": caps})

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
        if any(t.get("name") == "search" for t in body.get("tools") or []):
            return web.json_response({
                "content": [{"type": "text", "text": "Hi from Claude."}],
                "usage": {"input_tokens": 50, "cache_read_input_tokens": 4000,
                          "cache_creation_input_tokens": 0, "output_tokens": 9}})
        return web.json_response({"content": [
            {"type": "text", "text": "Here you go"},
            {"type": "tool_use", "name": "submit", "input": ANSWER},
        ]})

    app = web.Application()
    app.router.add_get("/v1/models", openai_models)
    app.router.add_post("/v1/chat/completions", openai_chat)
    app.router.add_get("/api/v0/models/{mid}", lmstudio_model)
    app.router.add_get("/api/tags", ollama_tags)
    app.router.add_post("/api/chat", ollama_chat)
    app.router.add_get("/anthropic/v1/models", anthropic_models)
    app.router.add_post("/anthropic/v1/messages", anthropic_messages)
    server = await aiohttp_server(app)
    server.seen = seen
    server.chat_steps = chat_steps
    server.overrides = overrides
    return server
