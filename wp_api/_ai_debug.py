"""The AI debug log on the server side (`engine/ai/debug_log.py` keeps it).

The browser turns it on per request: with Settings › AI assistant › Debug
log on, every AI POST carries an ``X-WP-Debug`` id, and `track` opens a
record under it. `record_call` (from `_ai_client._request` and
`_ai_chat._post`, the two places every model request goes through) adds
each model call to the record of the request it serves. ``WP_AI_DEBUG=1``
records every AI request, with or without a browser (evals).

`GET /wp/api/ai/debug` lists the kept records; `GET /wp/api/ai/debug/{id}`
gives one as JSON, or as the Markdown copy with ``?format=md``. Files go to
``ai-debug/`` in our data folder, one per request.
"""
from __future__ import annotations

import contextvars
import functools
import json
import os
import re
import secrets
import time
import urllib.parse
from pathlib import Path
from typing import Any

from aiohttp import web

from engine.ai import debug_log
from wp_api._helpers import json_error, json_ok

#: The id of the action being served, set by `track`.
current: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "wp_ai_debug", default=None)

_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
#: Paths that reach the model (chat, completion, embeddings); the rest
#: (model lists, `/api/show`) are skipped.
_MODEL_PATHS = ("/chat/completions", "/messages", "/api/chat", "/responses", "/api/generate",
                "/embeddings", "/api/embed", "/completions")
#: What each route is, for the list and the copy's title.
LABELS = {
    "/wp/api/ai/chat": "Chat message",
    "/wp/api/ai/test": "Test connection",
    "/wp/api/ai/wildcard/draft": "Draft: wildcard options",
    "/wp/api/ai/wildcard/edit": "Draft: change options",
    "/wp/api/ai/derivation/draft": "Draft: derivation",
    "/wp/api/ai/constraint/draft": "Draft: constraint",
    "/wp/api/ai/text/draft": "Draft: text item",
    "/wp/api/ai/describe": "Describe",
    "/wp/api/ai/organize": "Organize",
    "/wp/api/ai/bundle/split": "Make sub-bundles",
    "/wp/api/ai/pack/plan": "Pack: plan",
    "/wp/api/ai/pack/change": "Pack: change",
    "/wp/api/ai/pack/review": "Pack: review",
    "/wp/api/ai/pack/images": "Pack: read images",
    "/wp/api/ai/pack/search": "Pack: web search",
    "/wp/api/ai/pack/item": "Pack: build item",
    "/wp/api/ai/pack/check": "Pack: check",
    "/wp/api/ai/pack/install": "Pack: install",
    "/wp/api/ai/chats/compact": "Chat: compact",
}
#: Request fields that say what the user asked, first found wins.
_ASKED = ("message", "request", "prompt", "note", "instruction", "text", "description")


def env_on() -> bool:
    return os.environ.get("WP_AI_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")


def folder() -> Path | None:
    from engine.db.connection import wp_data_dir

    base = wp_data_dir()
    return base / "ai-debug" if base is not None else None


def active() -> bool:
    return current.get() is not None


def _label(path: str) -> str:
    if path.startswith("/wp/api/ai/chats/") and path.endswith("/compact"):
        return LABELS["/wp/api/ai/chats/compact"]
    return LABELS.get(path, path.rsplit("/wp/api/ai/", 1)[-1])


async def _asked(request: web.Request) -> str:
    try:
        raw = await request.read()  # aiohttp keeps it for the handler
        body = json.loads(raw) if raw else None
    except (ValueError, UnicodeDecodeError, web.HTTPException):
        return ""
    if not isinstance(body, dict):
        return ""
    for key in _ASKED:
        v = body.get(key)
        if isinstance(v, str) and v.strip():
            v = " ".join(v.split())
            return v if len(v) <= 400 else v[:400] + "…"
    return ""


def track(handler: Any) -> Any:
    """Wraps an AI route: a request carrying ``X-WP-Debug`` (or any request,
    with ``WP_AI_DEBUG=1``) records its model calls."""
    @functools.wraps(handler)
    async def wrapped(request: web.Request) -> Any:
        aid = request.headers.get("X-WP-Debug")
        if not (aid and _ID.match(aid)):
            if not env_on() or request.method != "POST":
                return await handler(request)
            aid = secrets.token_hex(8)
        from engine.ai import config as ai_config
        from wp_api import INSTALLED_VERSION

        cfg = ai_config.load_effective()
        debug_log.begin(aid, request.path, meta={
            "label": _label(request.path), "asked": await _asked(request),
            "provider": cfg.get("provider"), "model": cfg.get("model"),
            "version": INSTALLED_VERSION,
        })
        token = current.set(aid)
        status: int | None = None
        error: str | None = None
        try:
            resp = await handler(request)
            status = getattr(resp, "status", None)
            body = resp.body if isinstance(resp, web.Response) else None
            if status is not None and status >= 400 and isinstance(body, (bytes, bytearray)):
                try:
                    error = str(json.loads(body).get("error") or "")[:500] or None
                except (ValueError, TypeError, AttributeError):
                    error = None
            return resp
        except BaseException as e:
            error = f"{type(e).__name__}: {e}"[:500]
            raise
        finally:
            current.reset(token)
            debug_log.finish(aid, status=status, error=error, folder=folder())

    return wrapped


def records(path: str) -> bool:
    """Whether a model request to `path` goes in the log right now."""
    return active() and urllib.parse.urlsplit(path).path.endswith(_MODEL_PATHS)


def record_call(cfg: dict[str, Any], path: str, *, body: Any, started: float,
                response: Any = None, error: Any = None, streamed: bool = False) -> None:
    """One model request of the action being served (nothing when the log
    is off for it). `error` is the AIError it raised, if any."""
    aid = current.get()
    if aid is None or not records(path):
        return
    host = urllib.parse.urlsplit(str(cfg.get("base_url") or "")).netloc
    call: dict[str, Any] = {
        "path": path, "provider": cfg.get("provider"), "model": cfg.get("model"),
        "host": host, "seconds": round(time.monotonic() - started, 1),
        "streamed": streamed, "request": body, "response": response,
    }
    if error is not None:
        call["error"] = str(getattr(error, "message", None) or error)[:2000]
        call["status"] = getattr(error, "upstream", None) or getattr(error, "status", None)
    debug_log.add_call(aid, call)


# ── Routes ─────────────────────────────────────────────────────────────────

async def get_list(request: web.Request) -> web.Response:
    return json_ok({"records": debug_log.listing(), "folder": str(folder() or "")})


async def get_one(request: web.Request) -> web.Response:
    rec = debug_log.get(request.match_info["aid"])
    if rec is None:
        return json_error("that request isn't in the debug log any more", status=404)
    if request.query.get("format") == "md":
        return web.Response(text=debug_log.markdown(rec), content_type="text/markdown",
                            charset="utf-8")
    return json_ok(rec)


async def delete_all(request: web.Request) -> web.Response:
    debug_log.clear()
    return json_ok({"cleared": True})
