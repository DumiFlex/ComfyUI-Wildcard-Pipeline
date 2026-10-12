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

    async def openai_models(request):
        return web.json_response({"data": [{"id": "m1"}, {"id": "m2"}]})

    async def openai_chat(request):
        body = await request.json()
        seen.append({"path": request.path, "headers": dict(request.headers), "body": body})
        schema_name = body["response_format"]["json_schema"]["name"]
        content = {"ok": True} if schema_name == "probe" else EDIT_ANSWERS.get(schema_name, ANSWER)
        if schema_name == "chat_step":
            content = chat_steps.pop(0) if chat_steps else {"message": "Done.", "calls": []}
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
    server.chat_steps = chat_steps
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
    ])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "messages": [{"role": "user", "content": "hi"},
                     {"role": "assistant", "content": "Hello!"},
                     {"role": "user", "content": "more weapons, no blades for mages"}],
        "page": {"route": "modules-edit", "id": tgt},
    })
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["message"] == "Here are two more weapons and a rule."
    assert [s["tool"] for s in body["steps"]] == [
        "search", "read", "read", "add_options", "create_constraint"]
    assert body["steps"][2]["ok"] is False
    add, con = body["proposals"]
    assert add["pid"] == "p1" and add["op"]["op"] == "update" and add["op"]["id"] == tgt
    assert [o["value"] for o in add["op"]["body"]["payload"]["options"]][-1] == "war axe"
    assert con["op"]["body"]["payload"]["matrix"] == {
        "magic": {"blade": {"mode": "exclude", "factor": 0}}}
    first, second = fake_llm.seen[-2:]
    msgs = first["body"]["messages"]
    assert msgs[0]["role"] == "system" and "Items (id" in msgs[0]["content"]
    assert msgs[1]["content"] == "hi" and json.loads(msgs[2]["content"])["message"] == "Hello!"
    assert 'The user has wildcard "Weapon"' in msgs[-1]["content"]
    results = second["body"]["messages"][-1]["content"]
    assert results.startswith("Tool results:") and "longsword" in results
    assert "error: no item with id 'nope'" in results


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
