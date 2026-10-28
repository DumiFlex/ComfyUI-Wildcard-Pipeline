"""Embeddings for the library index's meaning search (opt-in).

Off unless Settings › AI assistant › Meaning search names a model. Ollama
uses its native `/api/embed` (a batch `input`); everything else
OpenAI-compatible uses `/embeddings` (LM Studio, OpenAI, OpenRouter, Voyage,
a llama.cpp server started with `--embeddings`, which needs its own
address). Claude has no embeddings API, so with Claude the embedding server
is always another address. See `/pr-drafts/ai-embeddings-providers.md`.

Item vectors are filled in the background a batch at a time after the index
syncs, so a chat never waits for a whole library to embed; until they are
all there, search simply finds fewer items by meaning. See
`/pr-drafts/ai-retrieval-index.md`.
"""
from __future__ import annotations

import asyncio
import logging
import time
import urllib.parse
from collections import OrderedDict
from typing import Any

import aiohttp

from engine.ai import index as ai_index
from wp_api import _ai_client as client

log = logging.getLogger(__name__)

BATCH = 32
_TIMEOUT = aiohttp.ClientTimeout(total=120, sock_connect=10)
_SHORT = aiohttp.ClientTimeout(total=5, sock_connect=3)
#: Recent query vectors, so a search repeated in one chat costs nothing.
_QUERY_CACHE: OrderedDict[tuple[str, str], list[float]] = OrderedDict()
_QUERY_CACHE_SIZE = 256
#: Index ids with a fill running, so only one runs per index.
_filling: set[int] = set()
#: First and longest wait before the background fill tries a failing
#: embedding server again. Opening the settings polls the index and every
#: chat turn starts a fill, so without a wait a stopped server meant a failed
#: request (and a console line) every few seconds.
RETRY_FIRST_S = 30.0
RETRY_MAX_S = 600.0
_now = time.monotonic


class _Failing:
    """An embedding server+model that failed: what it said and when to try
    again. Gone once a request to it works."""

    def __init__(self) -> None:
        self.message = ""
        self.fails = 0
        self.retry_at = 0.0


#: Keyed by (embedding address, model), so changing either starts fresh.
_failing: dict[tuple[str, str], _Failing] = {}


def _key(cfg: dict[str, Any]) -> tuple[str, str]:
    return (str(_cfg(cfg).get("base_url") or ""), str(cfg.get("embed_model") or ""))


def _failed(cfg: dict[str, Any], message: str) -> None:
    """Remember a failure and wait longer before the next try. Logs once
    per new message, not on every retry."""
    st = _failing.setdefault(_key(cfg), _Failing())
    st.fails += 1
    st.retry_at = _now() + min(RETRY_FIRST_S * 2 ** (st.fails - 1), RETRY_MAX_S)
    if message != st.message:
        st.message = message
        log.warning("wildcard-pipeline: meaning search paused: %s "
                    "(keyword search still works; retrying in the background)", message)
    else:
        log.debug("wildcard-pipeline: embedding still failing (%d tries): %s",
                  st.fails, message)


def _worked(cfg: dict[str, Any]) -> None:
    if _failing.pop(_key(cfg), None) is not None:
        log.info("wildcard-pipeline: meaning search works again")


def waiting(cfg: dict[str, Any]) -> bool:
    """Whether the embedding server failed and its next try is still due."""
    st = _failing.get(_key(cfg))
    return st is not None and _now() < st.retry_at


def last_error(cfg: dict[str, Any]) -> str | None:
    """What the embedding server said when it last failed, until it works."""
    st = _failing.get(_key(cfg))
    return st.message if st is not None else None


def retry_now(cfg: dict[str, Any]) -> None:
    """Let the next fill try at once (Rebuild).
    A still-failing server logs again then, so a retry the user asked for
    shows its outcome."""
    _failing.pop(_key(cfg), None)


def enabled(cfg: dict[str, Any]) -> bool:
    return bool(cfg.get("embed_model")) and (cfg.get("embed_api") or cfg.get("api")) != "anthropic"


def _cfg(cfg: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg)
    out["base_url"] = cfg.get("embed_base_url") or cfg["base_url"]
    # The key goes only where it was given for (engine/ai/config.py).
    out["api_key"] = cfg.get("embed_api_key", "")
    out["api"] = cfg.get("embed_api") or cfg["api"]
    return out


async def list_models(cfg: dict[str, Any]) -> list[str]:
    """The embedding server's models (the chat server when it has no
    address of its own), only its embedding models where the server says
    which those are: OpenRouter's embeddings list, LM Studio's model types.
    Raises client.AIError."""
    ecfg = _cfg(cfg)
    if ecfg["api"] == "anthropic":
        raise client.AIError("Claude has no embeddings API", status=400)
    if ecfg["api"] == "openai":
        host = (urllib.parse.urlsplit(ecfg["base_url"]).hostname or "").lower()
        if host == "openrouter.ai" or host.endswith(".openrouter.ai"):
            return await _ids(ecfg, "/models?output_modalities=embeddings")
        typed = await _lmstudio_embedders(ecfg)
        if typed is not None:
            return typed
    return await client.list_models(ecfg)


async def _ids(ecfg: dict[str, Any], path: str) -> list[str]:
    data = await client._request(ecfg, "GET", path, timeout=_TIMEOUT)
    items = data.get("data") if isinstance(data, dict) else None
    return sorted({m["id"] for m in items or [] if isinstance(m, dict)
                   and isinstance(m.get("id"), str) and m["id"]})


async def _lmstudio_embedders(ecfg: dict[str, Any]) -> list[str] | None:
    """LM Studio's own model list says which models embed (`type`); None
    when the server isn't LM Studio."""
    parts = urllib.parse.urlsplit(ecfg["base_url"])
    native = {**ecfg, "base_url": f"{parts.scheme}://{parts.netloc}"}
    try:
        data = await client._request(native, "GET", "/api/v0/models", timeout=_SHORT)
    except client.AIError:
        return None
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list) or not all(isinstance(m, dict) and "type" in m for m in items):
        return None
    return sorted({m["id"] for m in items if m.get("type") in ("embeddings", "embedding")
                   and isinstance(m.get("id"), str)})


async def embed(cfg: dict[str, Any], texts: list[str]) -> list[list[float]]:
    """One vector per text, in order. Raises client.AIError."""
    if not enabled(cfg):
        raise client.AIError("meaning search is off", status=400)
    ecfg = _cfg(cfg)
    if ecfg["api"] == "ollama":
        body: dict[str, Any] = {"model": cfg["embed_model"], "input": texts,
                                "keep_alive": f"{int(cfg.get('unload_after_s') or 0)}s"}
        data = await client._request(ecfg, "POST", "/api/embed", body=body, timeout=_TIMEOUT)
        vecs = data.get("embeddings") if isinstance(data, dict) else None
    else:
        data = await client._request(ecfg, "POST", "/embeddings",
                                     body={"model": cfg["embed_model"], "input": texts},
                                     timeout=_TIMEOUT)
        items = data.get("data") if isinstance(data, dict) else None
        vecs = None
        if isinstance(items, list):
            ordered = sorted((x for x in items if isinstance(x, dict)),
                             key=lambda x: x.get("index", 0))
            vecs = [x.get("embedding") for x in ordered]
    if (not isinstance(vecs, list) or len(vecs) != len(texts)
            or not all(isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v)
                       for v in vecs)):
        raise client.AIError("the embedding model's answer wasn't a list of vectors. "
                             "Is it an embedding model?")
    return [[float(x) for x in v] for v in vecs]


async def query_vector(cfg: dict[str, Any], text: str) -> list[float] | None:
    """The query's vector, or None when meaning search is off or failed
    (search then uses keywords only)."""
    if not enabled(cfg) or not text.strip():
        return None
    key = (cfg["embed_model"], text.strip()[:2000])
    if key in _QUERY_CACHE:
        _QUERY_CACHE.move_to_end(key)
        return _QUERY_CACHE[key]
    # A server that just failed isn't asked again on every search: each try
    # would cost the chat a connect timeout.
    if waiting(cfg):
        return None
    try:
        vec = (await embed(cfg, [key[1]]))[0]
    except client.AIError as e:
        _failed(cfg, e.message)
        return None
    _worked(cfg)
    _QUERY_CACHE[key] = vec
    while len(_QUERY_CACHE) > _QUERY_CACHE_SIZE:
        _QUERY_CACHE.popitem(last=False)
    return vec


async def fill(cfg: dict[str, Any], idx: ai_index.Index, *, max_batches: int = 1000) -> int:
    """Embed the items that have no current vector, a batch at a time.
    Returns how many were embedded; stops at the first error, which is
    logged once and makes the next background fill wait (`_failed`)."""
    model = cfg["embed_model"]
    done = 0
    for _ in range(max_batches):
        todo = idx.embed_todo(model, BATCH)
        if not todo:
            break
        try:
            vecs = await embed(cfg, [t for _i, _s, t in todo])
        except client.AIError as e:
            _failed(cfg, e.message)
            break
        _worked(cfg)
        idx.put_vectors(model, [(i, s, v) for (i, s, _t), v in zip(todo, vecs, strict=True)])
        done += len(todo)
    return done


def fill_in_background(cfg: dict[str, Any], idx: ai_index.Index) -> bool:
    """Start filling vectors unless a fill already runs for this index.
    Detached from the request: Stop or a closed tab doesn't cut it short.
    Skipped while a failed embedding server's retry wait runs."""
    if not enabled(cfg) or id(idx) in _filling or waiting(cfg) \
            or not idx.embed_todo(cfg["embed_model"], 1):
        return False
    _filling.add(id(idx))

    async def run() -> None:
        try:
            await fill(cfg, idx)
        finally:
            _filling.discard(id(idx))

    asyncio.ensure_future(run())
    return True


def filling(idx: ai_index.Index) -> bool:
    return id(idx) in _filling


async def _ollama_loaded(cfg: dict[str, Any]) -> list[str] | None:
    try:
        data = await client._request(cfg, "GET", "/api/ps", timeout=client._LIST_TIMEOUT)
    except client.AIError:
        return None
    models = data.get("models") if isinstance(data, dict) else None
    return [str(m.get("name") or m.get("model") or "") for m in models or []
            if isinstance(m, dict)]


async def check(cfg: dict[str, Any]) -> dict[str, Any] | None:
    """For Test connection: does the embedding model answer, how long are
    its vectors, and (Ollama) did loading it push the chat model out of
    memory? That happens when Ollama keeps one model at a time (its default
    on Windows with a Radeon GPU), and it would reload the chat model, and
    lose what it had read, on every search."""
    if not enabled(cfg):
        return None
    out: dict[str, Any] = {"ok": False, "dims": None, "error": None, "swapped": False}
    try:
        vec = (await embed(cfg, ["warm colors"]))[0]
    except client.AIError as e:
        out["error"] = e.message
        return out
    # It answers now, so the background fill needn't sit out its wait.
    _worked(cfg)
    out["ok"] = True
    out["dims"] = len(vec)
    if cfg["api"] == "ollama" and _cfg(cfg)["base_url"] == cfg["base_url"]:
        loaded = await _ollama_loaded(cfg)
        chat = cfg.get("model") or ""
        if loaded is not None and chat and not any(
                n == chat or n.split(":")[0] == chat.split(":")[0] for n in loaded):
            out["swapped"] = True
    return out
