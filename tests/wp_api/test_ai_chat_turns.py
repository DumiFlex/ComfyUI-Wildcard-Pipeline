"""An answer's footer (usage, time, rating, Delete this turn), the model
list's loaded dots, prompt progress while a long prompt is read, the
"minimal" thinking level and Test connection's second try."""
from __future__ import annotations

import re

import pytest
from aiohttp import web

from engine.ai import chatlog
from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _cfg, _json, _on, _sse, streamer  # noqa: F401
from wp_api import _ai_chat, _ai_client, _ai_thinking, _ai_turn


async def test_an_answer_says_what_it_used_and_when(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hi!", "calls": []})
    out = await _chat(wp_client, "hello")
    assert out["spent"]["calls"] == 1
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", out["at"])
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{out['chat_id']}"))
    reply = chat["turns"][-1]
    assert reply["view"]["at"] == out["at"] and reply["view"]["spent"] == out["spent"]


async def test_a_rating_is_kept_with_the_chat_and_taken_back(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hi!", "calls": []})
    out = await _chat(wp_client, "hello")
    url = f"/wp/api/ai/chats/{out['chat_id']}/rating"
    await _json(await wp_client.put(url, json={"at": out["at"], "rating": "down"}))
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{out['chat_id']}"))
    assert chat["ratings"] == {out["at"]: "down"}
    await _json(await wp_client.put(url, json={"at": out["at"], "rating": ""}))
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{out['chat_id']}"))
    assert chat["ratings"] == {}
    await _json(await wp_client.put(url, json={"at": out["at"], "rating": "meh"}), 400)
    await _json(await wp_client.put(url, json={"at": "2000-01-01", "rating": "up"}), 404)
    await _json(await wp_client.put("/wp/api/ai/chats/nope/rating",
                                    json={"at": out["at"], "rating": "up"}), 404)


async def test_delete_this_turn_drops_the_message_and_its_answer(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "One.", "calls": []},
                                {"message": "Two.", "calls": []},
                                {"message": "Three.", "calls": []}])
    first = await _chat(wp_client, "alpha question")
    second = await _chat(wp_client, "bravo question", chat_id=first["chat_id"])
    cid = first["chat_id"]
    await _json(await wp_client.put(f"/wp/api/ai/chats/{cid}/rating",
                                    json={"at": first["at"], "rating": "up"}))
    await _json(await wp_client.delete(f"/wp/api/ai/chats/{cid}/turns/{first['at']}"))
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{cid}"))
    said = [t.get("text") or t["view"]["message"] for t in chat["turns"]]
    assert said == ["bravo question", "Two."]
    assert chat["ratings"] == {}
    await _json(await wp_client.delete(f"/wp/api/ai/chats/{cid}/turns/{first['at']}"), 404)
    # The model no longer sees it either.
    await _chat(wp_client, "third", chat_id=cid)
    sent = str(fake_llm.seen[-1]["body"]["messages"])
    assert "alpha question" not in sent and "bravo question" in sent
    assert second["at"]


def test_turn_span_finds_a_turn_by_its_answers_time():
    log = [{"kind": "user"}, {"kind": "step"}, {"kind": "shown", "view": {"at": "a"}},
           {"kind": "user"}, {"kind": "step"}, {"kind": "shown", "view": {"at": "b"}}]
    assert chatlog.turn_span(log, "a") == (0, 3)
    assert chatlog.turn_span(log, "b") == (3, 6)
    assert chatlog.turn_span(log, "c") is None


def test_usage_adds_up_over_steps():
    total = _ai_turn.add_usage({}, {"prompt": 100, "cached": 80, "output": 5, "thinking": 9})
    total = _ai_turn.add_usage(total, {"prompt": 120, "output": 7})
    assert total == {"prompt": 220, "cached": 80, "output": 12, "calls": 2}
    # A paused turn's earlier total adds its calls without counting one more.
    assert _ai_turn.add_usage(total, total, calls=False)["calls"] == 4
    assert _ai_turn.add_usage({}, None) == {"calls": 1}


@pytest.mark.parametrize(("entry", "want"), [
    ({"id": "a", "status": {"value": "loaded"}}, True),
    ({"id": "a", "status": {"value": "unloaded"}}, False),
    ({"id": "a", "state": "loaded"}, True),
    ({"id": "a", "state": "not-loaded"}, False),
    ({"id": "a", "loaded": True}, True),
    ({"id": "a", "loaded_instances": []}, False),
    ({"id": "a"}, None),
    ("a", None),
])
def test_entry_loaded_reads_each_servers_status(entry, want):
    assert _ai_client.entry_loaded(entry) is want


@pytest.fixture
async def status_server(aiohttp_server):
    """A local server whose status routes the test sets."""
    routes: dict = {}

    def route(path):
        async def handler(_request):
            if path not in routes:
                return web.json_response({"error": "no"}, status=404)
            return web.json_response(routes[path])
        return handler

    app = web.Application()
    for p in ("/v1/model-status", "/v1/models", "/api/v0/models", "/api/ps"):
        app.router.add_get(p, route(p))
    server = await aiohttp_server(app)
    server.routes = routes
    return server


async def test_loaded_models_asks_the_launcher_first(status_server):
    status_server.routes["/v1/model-status"] = {"data": [
        {"id": "qwen", "status": "loaded"}, {"id": "inkling", "status": "unloaded"}]}
    status_server.routes["/v1/models"] = {"data": [{"id": "qwen"}, {"id": "inkling"}]}
    cfg = {**_cfg(status_server), "local": True}
    assert await _ai_client.loaded_models(cfg) == ["qwen"]


async def test_loaded_models_falls_back_to_lm_studio(status_server):
    status_server.routes["/v1/models"] = {"data": [{"id": "qwen"}]}
    status_server.routes["/api/v0/models"] = {"data": [
        {"id": "qwen", "state": "loaded"}, {"id": "gemma", "state": "not-loaded"}]}
    cfg = {**_cfg(status_server), "local": True}
    assert await _ai_client.loaded_models(cfg) == ["qwen"]


async def test_loaded_models_reads_ollama_ps(status_server):
    status_server.routes["/api/ps"] = {"models": [{"name": "qwen3:8b"}]}
    cfg = {**_cfg(status_server, api="ollama"), "local": True}
    assert await _ai_client.loaded_models(cfg) == ["qwen3:8b"]


async def test_loaded_models_says_nothing_when_it_cant_tell(status_server):
    status_server.routes["/v1/models"] = {"data": [{"id": "qwen"}]}
    assert await _ai_client.loaded_models({**_cfg(status_server), "local": True}) is None
    assert await _ai_client.loaded_models(_cfg(status_server)) is None


async def test_prompt_progress_goes_live_as_a_percentage(streamer):  # noqa: F811
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse(
        {"choices": [], "prompt_progress": {"total": 1000, "cache": 200, "processed": 200}},
        {"choices": [], "prompt_progress": {"total": 1000, "cache": 200, "processed": 600}},
        {"choices": [], "prompt_progress": {"total": 1000, "cache": 200, "processed": 600}},
        {"choices": [{"delta": {"content": "Hi"}}]},
    )
    events: list = []

    async def emit(e):
        events.append(e)

    await _ai_chat._post(_cfg(streamer), "/chat/completions", {"model": "m"},
                         kind="openai", emit=emit, show=True)
    got = [e["v"] for e in events if e["type"] == "progress"]
    assert got == sorted(set(got)) and got[-1] == 60 and len(got) == 2


def test_a_template_with_minimal_offers_it():
    info = _ai_thinking.from_template(
        "{% if reasoning_effort == 'minimal' %}{% elif reasoning_effort == 'high' %}{% endif %}")
    assert info is not None and info["options"] == ["minimal", "high"]


def test_props_asks_for_the_chosen_model():
    assert _ai_client.props_path({"model": "a b/c"}) == "/props?model=a%20b%2Fc"
    assert _ai_client.props_path({}) == "/props"


async def test_test_connection_gives_a_model_that_thinks_anyway_room(monkeypatch):
    caps: list = []

    async def models(_cfg):
        return ["inkling"]

    async def answer(_cfg, **kw):
        caps.append(kw["max_tokens"])
        if kw["max_tokens"] < 100:
            raise _ai_client.AIError("the reply stopped at the length limit")
        return {"ok": True}

    async def ctx(_cfg):
        return 32768

    monkeypatch.setattr(_ai_client, "list_models", models)
    monkeypatch.setattr(_ai_client, "complete_json", answer)
    monkeypatch.setattr(_ai_client, "server_context", ctx)
    out = await _ai_client.probe({"model": "inkling", "api": "openai"})
    assert caps == [64, _ai_client.PROBE_THINK_ROOM]
    assert out["ok"] and out["json_ok"] and out["thinks_anyway"] is True


async def test_test_connection_doesnt_ask_again_when_the_server_refused(monkeypatch):
    calls: list = []

    async def models(_cfg):
        return ["m"]

    async def answer(_cfg, **kw):
        calls.append(kw)
        err = _ai_client.AIError("bad request")
        err.upstream = 400
        raise err

    monkeypatch.setattr(_ai_client, "list_models", models)
    monkeypatch.setattr(_ai_client, "complete_json", answer)
    out = await _ai_client.probe({"model": "m", "api": "openai"})
    assert len(calls) == 1 and not out["ok"] and "thinks_anyway" not in out
