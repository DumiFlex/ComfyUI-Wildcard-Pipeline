"""/wp/api/ai/* against fake model servers for each wire format."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

from engine.ai import chat as ai_chat
from engine.ai import config as ai_config
from wp_api import _ai_client

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
        schema_name = body["response_format"]["json_schema"]["name"]
        content = {"ok": True} if schema_name == "probe" else EDIT_ANSWERS.get(schema_name, ANSWER)
        if schema_name in overrides:
            content = overrides[schema_name]
        if schema_name == "chat_step":
            content = chat_steps.pop(0) if chat_steps else {"message": "Done.", "calls": []}
        text = content if isinstance(content, str) else json.dumps(content)
        return web.json_response({"choices": [{"message": {"content": text}}]})

    async def lmstudio_model(request):
        return web.json_response({"id": request.match_info["mid"], "loaded_context_length": 4096})

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


def _draft_body():
    return {
        "instruction": "more hair colours", "count": 5,
        "wildcard": {"name": "hair", "var_binding": "hair", "payload": {
            "options": [{"id": "a1", "value": "red hair", "weight": 1}],
            "sub_categories": ["cool"],
        }},
    }


async def test_everything_but_config_is_off_by_default(wp_client):
    for path in ("/wp/api/ai/models", "/wp/api/ai/test", "/wp/api/ai/wildcard/draft",
                 "/wp/api/ai/wildcard/edit"):
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
    # The window is sized to the prompt, a power of two within the cap.
    assert sent["options"]["num_ctx"] in (4096, 8192)
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


def _edit_body(action):
    return {
        "action": action, "instruction": "drop anything modern",
        "wildcard": {"name": "outfit", "var_binding": "outfit", "payload": {
            "options": [
                {"id": "null0001", "value": "", "weight": 1, "is_null": True},
                {"id": "aaaa0001", "value": "red cloak", "weight": 1, "sub_categories": []},
                {"id": "aaaa0002", "value": "hoodie, jeans", "weight": 1, "sub_categories": []},
            ],
            "sub_categories": [],
        }},
    }


async def test_edit_maps_numbers_back_to_real_option_ids(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/wildcard/edit", json=_edit_body("remove"))
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["action"] == "remove"
    assert body["changes"] == [{
        "option_id": "aaaa0002", "before": {"value": "hoodie, jeans"},
        "after": None, "reason": "modern",
    }]
    assert body["skipped"][0]["reason"] == "not an option in the list"
    sent = fake_llm.seen[-1]["body"]
    prompt = sent["messages"][1]["content"]
    # The null option isn't shown, real ids never are.
    assert "1. red cloak" in prompt and "2. hoodie, jeans" in prompt
    assert "aaaa0001" not in prompt
    assert sent["temperature"] == 0.3


async def test_edit_rewrite_returns_before_and_after(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/wildcard/edit", json=_edit_body("rewrite"))
    body = await resp.json()
    assert body["changes"] == [{
        "option_id": "aaaa0001", "before": {"value": "red cloak"},
        "after": {"value": "a long red cloak"},
    }]


async def test_edit_input_validation(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/wildcard/edit"
    assert (await wp_client.post(url, json=_edit_body("explode"))).status == 400
    empty = _edit_body("remove")
    empty["wildcard"]["payload"]["options"] = []
    assert (await wp_client.post(url, json=empty)).status == 400
    many = _edit_body("remove")
    many["wildcard"]["payload"]["options"] = [
        {"id": f"{i:08x}", "value": f"opt {i}", "weight": 1} for i in range(301)
    ]
    resp = await wp_client.post(url, json=many)
    assert resp.status == 400
    assert "select up to 300" in await resp.text()


async def _wildcard(wp_client, name, var, options, tags):
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": name, "description": "", "category_id": None, "tags": [],
        "payload": {"var_binding": var, "sub_categories": tags, "options": options},
    })
    assert resp.status == 201, await resp.text()
    return (await resp.json())["id"]


async def _two_wildcards(wp_client):
    src = await _wildcard(wp_client, "Class", "class", [
        {"id": "aaaa0001", "value": "mage", "weight": 1, "sub_categories": ["magic"]},
        {"id": "aaaa0002", "value": "warrior", "weight": 1, "sub_categories": []},
    ], ["magic"])
    tgt = await _wildcard(wp_client, "Weapon", "weapon", [
        {"id": "bbbb0001", "value": "oak staff", "weight": 1, "sub_categories": []},
        {"id": "bbbb0002", "value": "longsword", "weight": 1, "sub_categories": ["blade"]},
    ], ["blade"])
    return src, tgt


async def test_derivation_draft_uses_library_variables(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/derivation/draft", json={
        "instruction": "give mages a title", "derivation": {"name": "Titles", "rules": []},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    [r] = body["rules"]
    cond = r["rule"]["branches"][0]["condition"]
    assert cond == {"var": "class", "op": "equals", "value": "mage"}
    assert r["warnings"] == []
    assert body["model"] == "m1"
    prompt = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert '$class (wildcard "Class"): mage, warrior' in prompt
    assert "$model_family" in prompt
    assert (await wp_client.post("/wp/api/ai/derivation/draft", json={})).status == 400


async def test_constraint_draft_reads_both_wildcards(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/constraint/draft"
    resp = await wp_client.post(url, json={
        "instruction": "mages never use swords",
        "constraint": {"source_wildcard_id": src, "target_wildcard_id": tgt,
                       "matrix": {}, "exceptions": []},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["cells"][0]["cell"] == {"mode": "exclude", "factor": 0}
    assert body["exceptions"][0]["exception"] == {
        "source": "mage", "target": "oak staff", "mode": "boost", "factor": 3,
        "source_id": "aaaa0001", "target_id": "bbbb0001",
    }
    prompt = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "S1. mage  [#magic]" in prompt and "T2. longsword  [#blade]" in prompt
    missing = {"instruction": "x", "constraint": {"source_wildcard_id": src}}
    assert (await wp_client.post(url, json=missing)).status == 400
    gone = {"instruction": "x",
            "constraint": {"source_wildcard_id": src, "target_wildcard_id": "deadbeef"}}
    assert (await wp_client.post(url, json=gone)).status == 404


async def test_describe_reuses_library_tags(wp_client, fake_llm):
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "Hair", "description": "", "category_id": None,
        "tags": ["portrait"], "payload": {"options": []},
    })
    assert resp.status == 201
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/describe"
    resp = await wp_client.post(url, json={
        "kind": "wildcard", "name": "Class", "description": "", "tags": ["rpg"],
        "payload": {"var_binding": "class", "options": [{"id": "x", "value": "mage"}]},
        "hint": "for anime portraits",
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["description"] == "Fantasy classes."
    assert body["tags"] == [
        {"tag": "rpg", "new": False, "has": True},
        {"tag": "portrait", "new": False, "has": False},
    ]
    prompt = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "Library tags: portrait" in prompt and "- mage" in prompt
    assert "Request: for anime portraits" in prompt
    assert (await wp_client.post(url, json={"kind": "nope"})).status == 400


def _followup_body():
    body = _draft_body()
    body["instruction"] = "darker ones"
    body["history"] = [{
        "instruction": "more hair colours",
        "answer": {"options": [{"text": "pink hair", "weight": 1, "tags": [], "negative": ""}]},
        "note": "kept 0 of 1",
    }]
    return body


async def test_followup_replays_the_conversation_openai(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_followup_body())
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["answer"] == ANSWER
    msgs = fake_llm.seen[-1]["body"]["messages"]
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    # The first prompt is rebuilt from the FIRST request, with the editor's context.
    assert "more hair colours" in msgs[1]["content"] and "red hair" in msgs[1]["content"]
    assert "darker ones" not in msgs[1]["content"]
    assert json.loads(msgs[2]["content"])["options"][0]["text"] == "pink hair"
    assert "darker ones" in msgs[3]["content"] and "kept 0 of 1" in msgs[3]["content"]


async def test_followup_replays_the_conversation_ollama(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "ollama",
                      "base_url": str(fake_llm.make_url("")), "model": "qwen:9b"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_followup_body())
    assert resp.status == 200, await resp.text()
    msgs = fake_llm.seen[-1]["body"]["messages"]
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]


async def test_followup_anthropic_uses_tool_turns(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "anthropic", "api_key": "sk-ant",
                      "base_url": str(fake_llm.make_url("/anthropic")), "model": "claude-x"})
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_followup_body())
    assert resp.status == 200, await resp.text()
    msgs = fake_llm.seen[-1]["body"]["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    use = msgs[1]["content"][0]
    assert use["type"] == "tool_use" and use["name"] == "submit"
    assert use["input"]["options"][0]["text"] == "pink hair"
    result, text = msgs[2]["content"]
    assert result == {"type": "tool_result", "tool_use_id": use["id"], "content": "Shown."}
    assert "darker ones" in text["text"]


async def test_followup_history_is_validated(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/derivation/draft"
    base = {"instruction": "x", "derivation": {"rules": []}}
    for history in ("nope", [{"instruction": "a"}], [{"instruction": "a", "answer": {}}] * 9):
        resp = await wp_client.post(url, json={**base, "history": history})
        assert resp.status == 400, history


async def test_every_drafting_route_returns_its_raw_answer(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    history = [{"instruction": "first", "answer": {"rules": []}, "note": ""}]
    resp = await wp_client.post("/wp/api/ai/constraint/draft", json={
        "instruction": "also boost staffs", "history": history,
        "constraint": {"source_wildcard_id": src, "target_wildcard_id": tgt},
    })
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["answer"] == EDIT_ANSWERS["constraint_rules"]
    msgs = fake_llm.seen[-1]["body"]["messages"]
    assert "first" in msgs[1]["content"] and "also boost staffs" in msgs[3]["content"]
    resp = await wp_client.post("/wp/api/ai/describe", json={
        "kind": "wildcard", "payload": {}, "hint": "shorter",
        "history": [{"instruction": "", "answer": {"description": "x", "tags": []}}],
    })
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["answer"] == EDIT_ANSWERS["describe"]
    resp = await wp_client.post("/wp/api/ai/wildcard/edit", json=_edit_body("remove"))
    assert (await resp.json())["answer"] == EDIT_ANSWERS["wildcard_remove"]


async def test_organize_reads_items_and_maps_changes_back(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    resp = await wp_client.post("/wp/api/categories", json={"name": "Characters"})
    assert resp.status in (200, 201), await resp.text()
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/organize"
    resp = await wp_client.post(url, json={
        "items": [{"kind": "module", "id": src}, {"kind": "module", "id": tgt},
                  {"kind": "module", "id": src}],
        "instruction": "tidy it",
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["count"] == 2
    first, second = body["changes"]
    assert first["kind"] == "module" and first["id"] == src and first["name"] == "Class"
    assert first["category"]["name"] == "Characters" and first["category"]["new"] is False
    assert first["category"]["id"]
    assert first["tags_add"] == [{"tag": "rpg", "new": True}]
    assert second["id"] == tgt and second["category"] == {"name": "Gear", "new": True, "id": None}
    assert second["rating"] == "nsfw" and second["before"]["rating"] == "safe"
    assert body["new_categories"] == ["Gear"]
    prompt = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "Library categories: Characters" in prompt and '2. wildcard "Weapon"' in prompt
    assert "Request: tidy it" in prompt
    assert (await wp_client.post(url, json={"items": []})).status == 400
    gone = {"items": [{"kind": "bundle", "id": "deadbeef"}]}
    assert (await wp_client.post(url, json=gone)).status == 404
    many = {"items": [{"kind": "module", "id": f"{i:08x}"} for i in range(61)]}
    assert (await wp_client.post(url, json=many)).status == 400


async def test_chat_reads_then_proposes(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend([
        {"message": "Let me look.", "calls": [
            {"tool": "search", "args": '{"query": "weapon"}'},
            {"tool": "read", "args": json.dumps({"id": tgt})},
            {"tool": "read", "args": '{"id": "nope"}'},
        ]},
        {"message": "Here are two more weapons and a rule.", "calls": [
            {"tool": "add_options", "args": json.dumps(
                {"id": tgt, "options": [{"text": "war axe", "tags": ["blade"]},
                                        {"text": "longsword"}]})},
            {"tool": "create_constraint", "args": json.dumps({
                "source_id": src, "target_id": tgt,
                "rules": [{"source": "#magic", "target": "#blade", "effect": "exclude"}]})},
        ]},
        {"message": "Here are two more weapons and a rule.", "calls": [
            {"tool": "run_test", "args": json.dumps({
                "stack": ["Class", "Weapon"], "seeds": 20, "proposed": True})}]},
        {"message": "Checked: no blades for mages now.", "calls": []},
    ])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "hi"},
                     {"role": "assistant", "content": "Hello!"},
                     {"role": "user", "content": "more weapons, no blades for mages"}],
        "page": {"route": "modules-edit", "id": tgt},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["message"] == "Checked: no blades for mages now."
    assert [s["tool"] for s in body["steps"]] == [
        "search", "read", "read", "add_options", "create_constraint", "run_test"]
    assert body["steps"][2]["ok"] is False
    add, con = body["proposals"]
    assert add["pid"] == "p1" and add["op"]["op"] == "update" and add["op"]["id"] == tgt
    assert [o["value"] for o in add["op"]["body"]["payload"]["options"]][-1] == "war axe"
    assert con["op"]["body"]["payload"]["matrix"] == {
        "magic": {"blade": {"mode": "exclude", "factor": 0}}}
    first, second, nudged, checked = fake_llm.seen[-4:]
    # Changes that were never tried get one nudge to run them.
    assert ai_chat.CHECK_NUDGE in nudged["body"]["messages"][-1]["content"]
    assert "with the proposed changes" in checked["body"]["messages"][-1]["content"]
    msgs = first["body"]["messages"]
    assert msgs[0]["role"] == "system" and "Items (id" in msgs[0]["content"]
    assert msgs[1]["content"] == "hi" and json.loads(msgs[2]["content"])["message"] == "Hello!"
    assert 'The user has wildcard "Weapon"' in msgs[-1]["content"]
    results = second["body"]["messages"][-1]["content"]
    assert results.startswith("Tool results:") and "longsword" in results
    assert "error: no item with id 'nope'" in results


async def test_chat_uses_the_open_editor_and_the_docs(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [
            {"tool": "docs_search", "args": '{"query": "constraint exclude"}'},
            {"tool": "read", "args": json.dumps({"id": tgt})},
        ]},
        {"message": "Dropped the first one.", "calls": [
            {"tool": "edit_options", "args": json.dumps({"id": tgt, "remove": [1]})},
            {"tool": "open", "args": '{"doc": "constraint"}'},
        ]},
    ])
    editor = {"id": tgt, "name": "Weapon (draft)", "description": "", "tags": [],
              "category_id": None, "content_rating": "safe", "dirty": True,
              "payload": {"var_binding": "weapon", "sub_categories": ["blade"], "options": [
                  {"id": "x1", "value": "unsaved spear", "weight": 1, "sub_categories": []},
                  {"id": "x2", "value": "unsaved bow", "weight": 1, "sub_categories": []}]}}
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "remove the first option"}],
        "page": {"route": "wildcards-edit", "id": tgt, "note": "2 options shown",
                 "editor": editor},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    edit, doc = body["proposals"]
    assert edit["op"]["basis"] == "editor"
    assert [o["value"] for o in edit["op"]["body"]["payload"]["options"]] == ["unsaved bow"]
    assert doc["op"] == {"op": "open", "kind": "doc", "type": "doc", "id": "constraint"}
    assert [s["note"] for s in body["steps"][:2]] == [
        'Searched the docs for "constraint exclude"', "Read Weapon (draft)"]
    first, second = fake_llm.seen[-3:-1]
    assert "Docs pages (id: title)" in first["body"]["messages"][0]["content"]
    asked = first["body"]["messages"][-1]["content"]
    assert "with unsaved changes" in asked and "On screen: 2 options shown" in asked
    results = second["body"]["messages"][-1]["content"]
    assert "1. unsaved spear" in results and "constraint ›" in results


async def test_chat_validation_and_off(wp_client, fake_llm):
    body = {"messages": [{"role": "user", "content": "hi"}]}
    assert (await wp_client.post("/wp/api/ai/chat", json=body)).status == 403
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    assert (await wp_client.post("/wp/api/ai/chat", json={"messages": []})).status == 400
    long = {"messages": [{"role": "user", "content": "x"}] * 41}
    assert (await wp_client.post("/wp/api/ai/chat", json=long)).status == 400
    resp = await wp_client.post("/wp/api/ai/chat", json=body)
    assert (await resp.json()) == {"message": "Done.", "proposals": [], "steps": [], "model": "m1"}


async def test_chat_stops_after_max_steps(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend(
        [{"message": "", "calls": [{"tool": "variables", "args": "{}"}]}] * 10)
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "loop"}]})
    body = await resp.json()
    assert len(body["steps"]) == 6 and "ran out of steps" in body["message"]


async def test_chat_acts_when_the_user_says_yes_instead_of_asking_again(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    asked = "I'll build a medieval pack. Should I proceed with creating these items?"
    fake_llm.chat_steps.extend([
        {"message": asked, "calls": []},
        {"message": "Here it is.", "calls": [{"tool": "plan_pack", "args": json.dumps(
            {"description": "Medieval fantasy character: hair, eyes, outfit, scene, pose"})}]},
    ])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "build a medieval character pack"},
                     {"role": "assistant", "content": asked},
                     {"role": "user", "content": "yes"}],
        "page": {"route": "pack-builder", "note": "Pack builder, nothing planned yet"}})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["message"] == "Here it is."
    (card,) = body["proposals"]
    assert card["op"] == {"op": "open", "kind": "pack", "type": "pack", "id": "pack-builder",
                          "description": "Medieval fantasy character: hair, eyes, outfit, "
                                         "scene, pose"}
    # The repeat was sent back once with the nudge, then the calls came.
    assert ai_chat.GO_NUDGE in fake_llm.seen[-1]["body"]["messages"][-1]["content"]


async def test_chat_nudges_only_once(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend(
        [{"message": "Want me to use your hair wildcard or a new one?", "calls": []}] * 3)
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "add hair"}]})
    body = await resp.json()
    assert body["message"] == "Want me to use your hair wildcard or a new one?"
    assert len(fake_llm.chat_steps) == 1


PACK_PLAN = {
    "title": "Seasons", "summary": "Outfits by season.", "rating": "safe",
    "questions": [{"question": "How many?", "choices": ["Few", "Many"]}],
    "items": [
        {"kind": "wildcard", "name": "Season", "var": "season", "about": "seasons", "count": 4,
         "tags": ["cold", "warm"], "source": "", "target": ""},
        {"kind": "wildcard", "name": "Outfit", "var": "outfit", "about": "outfits", "count": 4,
         "tags": ["cold", "warm"], "source": "", "target": ""},
        {"kind": "constraint", "name": "Season → Outfit", "var": "", "about": "dress for it",
         "count": 0, "tags": [], "source": "season", "target": "outfit"},
        {"kind": "template", "name": "Scene", "var": "", "about": "uses both", "count": 0,
         "tags": [], "source": "", "target": ""},
    ],
}


async def test_pack_plan_build_check_install(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.overrides["pack_plan"] = PACK_PLAN
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "season outfits"})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    plan = body["plan"]
    assert [i["kind"] for i in plan["items"]] == ["wildcard", "wildcard", "constraint", "template"]
    assert body["answer"] == PACK_PLAN and plan["questions"][0]["choices"] == ["Few", "Many"]
    assert "Request: season outfits" in fake_llm.seen[-1]["body"]["messages"][1]["content"]

    opts = {
        "season": [("winter", ["cold"]), ("summer", ["warm"]), ("autumn", ["cold"]),
                   ("spring", ["warm"])],
        "outfit": [("parka", ["cold"]), ("sundress", ["warm"]), ("wool coat", ["cold"]),
                   ("shorts", ["warm"])],
    }
    built: dict = {}
    keys = {i["name"]: i["key"] for i in plan["items"]}
    for name, var in (("Season", "season"), ("Outfit", "outfit")):
        fake_llm.overrides["wildcard"] = {"options": [
            {"text": t, "weight": 1, "tags": tags, "negative": ""} for t, tags in opts[var]]}
        resp = await wp_client.post("/wp/api/ai/pack/item", json={
            "plan": plan, "built": built, "key": keys[name]})
        assert resp.status == 200, await resp.text()
        out = await resp.json()
        built[keys[name]] = {"id": out["id"], "payload": out["payload"]}
    fake_llm.overrides["constraint_rules"] = {"rules": [
        {"source": "#cold", "target": "#warm", "effect": "exclude", "factor": 0, "reason": ""}]}
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": keys["Season → Outfit"], "note": "x"})
    out = await resp.json()
    assert out["payload"]["source_wildcard_id"] == built[keys["Season"]]["id"]
    built[keys["Season → Outfit"]] = {"id": out["id"], "payload": out["payload"]}
    fake_llm.overrides["template"] = {"template": "$season day, wearing $outfit", "negative": ""}
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": keys["Scene"]})
    out = await resp.json()
    built[keys["Scene"]] = {"id": out["id"], "payload": out["payload"]}
    # A rebuild keeps the id.
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": keys["Scene"]})
    assert (await resp.json())["id"] == out["id"]

    resp = await wp_client.post("/wp/api/ai/pack/check", json={"plan": plan, "built": built})
    assert resp.status == 200, await resp.text()
    report = await resp.json()
    assert report["runs"] == 200 and report["failed"] == 0 and report["problems"] == {}
    for p in report["prompts"]:
        if p["text"].startswith(("winter", "autumn")):
            assert "sundress" not in p["text"] and "shorts" not in p["text"]

    resp = await wp_client.post("/wp/api/ai/pack/install", json={"plan": plan, "built": built})
    assert resp.status == 200, await resp.text()
    done = await resp.json()
    assert done["tag"] == "seasons" and done["undo_entry_id"]
    bundle = await (await wp_client.get(f"/wp/api/bundles/{done['bundle_id']}")).json()
    assert [c["meta"]["name"] for c in bundle["children"]] == [
        "Season", "Season → Outfit", "Outfit"]
    resp = await wp_client.post("/wp/api/import/undo",
                                json={"undo_entry_id": done["undo_entry_id"]})
    assert resp.status == 200
    assert (await wp_client.get(f"/wp/api/bundles/{done['bundle_id']}")).status == 404


async def test_pack_validation(wp_client, fake_llm):
    assert (await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "x"})).status == 403
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    assert (await wp_client.post("/wp/api/ai/pack/plan", json={})).status == 400
    fake_llm.overrides["pack_plan"] = {"title": "x", "items": []}
    assert (await wp_client.post("/wp/api/ai/pack/plan",
                                 json={"instruction": "x"})).status == 502
    plan = {**PACK_PLAN, "items": PACK_PLAN["items"][:1]}
    for path, extra in (("item", {"key": "nope"}), ("check", {}), ("install", {})):
        resp = await wp_client.post(f"/wp/api/ai/pack/{path}",
                                    json={"plan": plan, "built": {}, **extra})
        assert resp.status == 400, path
    assert (await wp_client.post("/wp/api/ai/pack/check", json={"plan": {}})).status == 400


async def test_text_draft_for_fixed_values_combine_and_template(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    url = "/wp/api/ai/text/draft"
    fake_llm.overrides["fixed_values"] = {"values": [
        {"name": "quality", "value": "best quality", "negative": "lowres"}]}
    resp = await wp_client.post(url, json={
        "kind": "fixed_values", "instruction": "quality tags",
        "item": {"name": "Quality", "payload": {"values": [
            {"id": "v1", "name": "quality", "value": "masterpiece"}]}},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["payload"]["values"] == [{"id": "v1", "name": "quality", "value": "best quality",
                                          "negative": "lowres"}]
    prompt = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "$quality = masterpiece" in prompt and "$class" in prompt

    fake_llm.overrides["combine"] = {"template": "$class with $weapon", "negative": ""}
    resp = await wp_client.post(url, json={
        "kind": "combine", "instruction": "join them",
        "item": {"name": "Hero", "payload": {"output_var": "hero", "template": ""}},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["payload"]["input_vars"] == ["class", "weapon"] and body["warnings"] == []

    fake_llm.overrides["prompt_template"] = {"template": "{a|b} $hero", "negative": ""}
    resp = await wp_client.post(url, json={"kind": "template", "instruction": "x", "item": {}})
    assert resp.status == 502
    fake_llm.overrides["prompt_template"] = {"template": "$hero, $class",
                                             "negative": "$negatives, lowres"}
    resp = await wp_client.post(url, json={"kind": "template", "instruction": "x", "item": {}})
    body = await resp.json()
    assert body["payload"] == {"template_string": "$hero, $class",
                               "negative_template": "$negatives, lowres"}
    assert any("$hero" in w for w in body["warnings"])

    assert (await wp_client.post(url, json={"kind": "nope", "instruction": "x"})).status == 400
    no_var = {"kind": "combine", "instruction": "x", "item": {"payload": {}}}
    assert (await wp_client.post(url, json=no_var)).status == 400


async def test_chat_sees_templates_and_runs_stacks(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    resp = await wp_client.post("/wp/api/templates", json={
        "name": "Hero shot", "template_string": "$class, $weapon"})
    assert resp.status in (200, 201), await resp.text()
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend([
        {"message": "Trying it.", "calls": [
            {"tool": "run_test", "args": json.dumps(
                {"stack": ["Class", "Weapon"], "seeds": 20, "template": "Hero shot"})},
        ]},
        {"message": "Adding a negative.", "calls": [
            {"tool": "edit_template", "args": json.dumps(
                {"id": "Hero shot", "negative": "$negatives, lowres"})},
        ]},
    ])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "check my hero template"}]})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert [s["tool"] for s in body["steps"]] == ["run_test", "edit_template"]
    assert body["steps"][0]["note"] == "Ran Class, Weapon on 20 seeds"
    [prop] = body["proposals"]
    assert prop["op"]["kind"] == "template" and prop["op"]["op"] == "update"
    assert prop["op"]["body"]["negative_template"] == "$negatives, lowres"
    results = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert "Ran 20 seeds." in results and "Prompt: " in results


async def test_connection_test_warns_about_a_small_loaded_context(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    body = await (await wp_client.post("/wp/api/ai/test")).json()
    assert body["ok"] and body["context"] == 4096 and body["context_low"] is True


async def test_chat_asks_again_when_a_step_is_not_json(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio", "model_size": "small",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.chat_steps.extend(["Sure! I will look at it", {"message": "Hi.", "calls": []}])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "hello"}]})
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["message"] == "Hi."
    retry = fake_llm.seen[-1]["body"]
    assert "couldn't be used (it wasn't valid JSON)" in retry["messages"][-1]["content"]
    # A small model gets the short prompt and a steady temperature.
    assert retry["temperature"] == 0.15
    assert "Making prompts coherent" not in retry["messages"][0]["content"]



async def test_pack_plan_sees_the_library_and_a_sample_and_gets_reviewed(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.overrides["pack_plan"] = {**PACK_PLAN, "items": [
        {"kind": "library", "name": "Class", "var": "", "about": "reuse", "count": 0,
         "tags": [], "source": "", "target": "", "use": ""},
        *PACK_PLAN["items"]]}
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "more like this", "sample": "mage, longsword, castle"})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    lib = body["plan"]["items"][0]
    assert lib["kind"] == "library" and lib["var"] == "class"
    assert isinstance(body["review"], list)
    asked = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "mage, longsword, castle" in asked and "- Class · $class · 2" not in asked
    assert "The user's library" in asked

    # The library item builds without the model.
    calls = len(fake_llm.seen)
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": body["plan"], "built": {}, "key": lib["key"]})
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["kind"] == "library" and len(fake_llm.seen) == calls

    fake_llm.overrides["pack_review"] = {"findings": [{"item": "", "text": "Add a mood."}]}
    resp = await wp_client.post("/wp/api/ai/pack/review", json={"plan": body["plan"], "ai": True})
    assert resp.status == 200, await resp.text()
    review = await resp.json()
    assert review["findings"][-1] == {"key": "", "level": "tip", "text": "Add a mood.",
                                      "by": "model"}
    assert review["note"].startswith("Revise the plan")
    resp = await wp_client.post("/wp/api/ai/pack/review", json={"plan": body["plan"]})
    assert all(f.get("by") != "model" for f in (await resp.json())["findings"])
