"""Embedding requests per wire format, and Test connection's swap check."""
from __future__ import annotations

import asyncio
import logging

import pytest
from aiohttp import web

from wp_api import _ai_client, _ai_embed


@pytest.fixture(autouse=True)
def _no_failures():
    _ai_embed._failing.clear()
    yield
    _ai_embed._failing.clear()


@pytest.fixture
async def embed_server(aiohttp_server):
    seen: list[dict] = []
    state = {"loaded": ["qwen:9b", "nomic-embed-text:latest"]}

    async def ollama_embed(request):
        body = await request.json()
        seen.append({"path": request.path, "body": body})
        return web.json_response({"embeddings": [[0.1, 0.2] for _ in body["input"]]})

    async def ollama_ps(request):
        return web.json_response({"models": [{"name": n} for n in state["loaded"]]})

    async def openai_embed(request):
        body = await request.json()
        seen.append({"path": request.path, "body": body,
                     "auth": request.headers.get("authorization")})
        if body["model"] == "chatty":
            return web.json_response({"choices": []})
        data = [{"index": i, "embedding": [float(i), 1.0, 0.0]} for i in range(len(body["input"]))]
        return web.json_response({"data": list(reversed(data))})

    app = web.Application()
    app.router.add_post("/api/embed", ollama_embed)
    app.router.add_get("/api/ps", ollama_ps)
    app.router.add_post("/v1/embeddings", openai_embed)
    server = await aiohttp_server(app)
    server.seen = seen
    server.state = state
    return server


def _cfg(server, api, **extra):
    base = str(server.make_url("/v1" if api == "openai" else ""))
    return {"api": api, "base_url": base.rstrip("/"), "model": "qwen:9b", "api_key": "",
            "embed_model": "nomic-embed-text", "embed_base_url": "", "unload_after_s": 60,
            **extra}


async def test_ollama_batch_embed(embed_server):
    vecs = await _ai_embed.embed(_cfg(embed_server, "ollama"), ["a", "b"])
    assert vecs == [[0.1, 0.2], [0.1, 0.2]]
    sent = embed_server.seen[-1]
    assert sent["path"] == "/api/embed"
    assert sent["body"] == {"model": "nomic-embed-text", "input": ["a", "b"], "keep_alive": "60s"}


async def test_openai_embed_keeps_order_and_sends_key(embed_server):
    cfg = _cfg(embed_server, "openai", embed_api_key="sk-x")
    vecs = await _ai_embed.embed(cfg, ["a", "b", "c"])
    assert [v[0] for v in vecs] == [0.0, 1.0, 2.0]
    assert embed_server.seen[-1]["auth"] == "Bearer sk-x"


async def test_separate_embedding_address(embed_server):
    cfg = _cfg(embed_server, "openai", base_url="http://127.0.0.1:9/v1",
               embed_base_url=str(embed_server.make_url("/v1")).rstrip("/"))
    assert len(await _ai_embed.embed(cfg, ["a"])) == 1


async def test_not_an_embedding_model(embed_server):
    with pytest.raises(_ai_client.AIError, match="embedding model"):
        await _ai_embed.embed(_cfg(embed_server, "openai", embed_model="chatty"), ["a"])
    assert await _ai_embed.query_vector(_cfg(embed_server, "openai", embed_model="chatty"),
                                        "x") is None


async def test_check_spots_ollama_unloading_the_chat_model(embed_server):
    cfg = _cfg(embed_server, "ollama")
    assert await _ai_embed.check(cfg) == {"ok": True, "dims": 2, "error": None,
                                          "swapped": False}
    embed_server.state["loaded"] = ["nomic-embed-text:latest"]
    assert (await _ai_embed.check(cfg))["swapped"] is True
    assert await _ai_embed.check({**cfg, "embed_model": ""}) is None


class _Idx:
    """Just what the background fill touches of an index."""

    def __init__(self, n: int) -> None:
        self.todo = [(i, "s", f"text {i}") for i in range(n)]
        self.vectors: list = []

    def embed_todo(self, _model, limit):
        return self.todo[:limit]

    def put_vectors(self, _model, rows):
        self.vectors += rows
        done = {i for i, _s, _v in rows}
        self.todo = [t for t in self.todo if t[0] not in done]


async def _settle():
    while _ai_embed._filling:
        await asyncio.sleep(0.01)


async def test_a_stopped_server_logs_once_and_backs_off(embed_server, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG, logger=_ai_embed.__name__)
    now = [1000.0]
    monkeypatch.setattr(_ai_embed, "_now", lambda: now[0])
    cfg = _cfg(embed_server, "openai", embed_base_url="http://127.0.0.1:9/v1")
    idx = _Idx(3)

    assert _ai_embed.fill_in_background(cfg, idx)
    await _settle()
    assert _ai_embed.waiting(cfg)
    assert "couldn't connect" in (_ai_embed.last_error(cfg) or "").lower()
    # Polling the index (the settings page, every chat turn) doesn't retry.
    for _ in range(5):
        assert not _ai_embed.fill_in_background(cfg, idx)
    assert await _ai_embed.query_vector(cfg, "warm") is None

    now[0] += _ai_embed.RETRY_FIRST_S + 1
    assert _ai_embed.fill_in_background(cfg, idx)
    await _settle()
    # Waits twice as long after the second failure.
    now[0] += _ai_embed.RETRY_FIRST_S + 1
    assert _ai_embed.waiting(cfg)
    now[0] += _ai_embed.RETRY_FIRST_S
    assert not _ai_embed.waiting(cfg)

    warnings = [r for r in caplog.records if r.levelno >= logging.INFO]
    assert len(warnings) == 1
    assert "meaning search paused" in warnings[0].getMessage()


async def test_the_wait_is_capped(embed_server, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(_ai_embed, "_now", lambda: now[0])
    cfg = _cfg(embed_server, "openai")
    for _ in range(20):
        _ai_embed._failed(cfg, "down")
    assert _ai_embed._failing[_ai_embed._key(cfg)].retry_at == _ai_embed.RETRY_MAX_S


async def test_recovery_logs_once_and_clears_the_error(embed_server, caplog):
    caplog.set_level(logging.INFO, logger=_ai_embed.__name__)
    cfg = _cfg(embed_server, "openai")
    _ai_embed._failed(cfg, "down")
    _ai_embed.retry_now(cfg)
    assert not _ai_embed.waiting(cfg)
    _ai_embed._failed(cfg, "down")
    _ai_embed._failing[_ai_embed._key(cfg)].retry_at = 0
    idx = _Idx(2)
    assert await _ai_embed.fill(cfg, idx) == 2
    assert _ai_embed.last_error(cfg) is None
    msgs = [r.getMessage() for r in caplog.records]
    # retry_now forgot the first failure, so the retry's failure printed again.
    assert sum("paused" in m for m in msgs) == 2
    assert sum("works again" in m for m in msgs) == 1


async def test_a_new_message_logs_again(embed_server, caplog):
    caplog.set_level(logging.INFO, logger=_ai_embed.__name__)
    cfg = _cfg(embed_server, "openai")
    _ai_embed._failed(cfg, "down")
    _ai_embed._failed(cfg, "down")
    _ai_embed._failed(cfg, "model not loaded")
    assert [r.levelno for r in caplog.records] == [logging.WARNING, logging.WARNING]
