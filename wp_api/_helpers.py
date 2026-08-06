"""Shared helpers for wp_api route handlers."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
from typing import Any

from aiohttp import web

from engine.db.connection import get_connection
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind


@contextmanager
def db_session(request: web.Request):
    """Yield a SQLite connection that is auto-closed on exit.

    If the aiohttp app has a ``wp_db`` key (injected by tests or the
    application startup), that connection is yielded directly and is NOT
    closed on exit (lifetime owned by the injector). Otherwise, a fresh
    file-based connection is opened via ``get_connection()`` and closed
    when the context manager exits.

    SQLite WAL mode + per-request connections avoid cross-task locking.
    """
    injected = request.app.get("wp_db") if hasattr(request, "app") else None
    if injected is not None:
        yield injected
        return
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def json_ok(data: Any, *, status: int = 200) -> web.Response:
    return web.json_response(data, status=status)


def json_error(message: str, *, status: int) -> web.Response:
    return web.json_response({"error": message}, status=status)


def make_etag(*parts: object) -> str:
    """A strong ETag from any values that identify a response's content.

    Callers pass a cheap fingerprint (row counts, version sums) rather than
    the response body, so the body never has to be built to find out whether
    it changed.
    """
    raw = "\x1f".join(str(p) for p in parts)
    return '"' + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32] + '"'


def matches_if_none_match(request: web.Request, etag: str) -> bool:
    """Whether the client already holds this exact representation.

    `If-None-Match` is a comma-separated list and each entry may carry the
    `W/` weak prefix, which is compared away — we only ever emit one tag, so
    weak and strong comparison agree.
    """
    header = request.headers.get("If-None-Match")
    if not header:
        return False
    if header.strip() == "*":
        return True
    wanted = etag.strip()
    for candidate in header.split(","):
        value = candidate.strip()
        if value.startswith("W/"):
            value = value[2:]
        if value == wanted:
            return True
    return False


def json_ok_revalidated(
    request: web.Request, data: Any, *, etag: str,
) -> web.Response:
    """`json_ok` plus conditional-request support.

    `Cache-Control: no-cache` means "store it, but revalidate before reuse" —
    NOT "don't store it". That is exactly what a poll wants: the browser keeps
    the body and sends `If-None-Match` on the next tick, and an unchanged
    library answers 304 with no body at all.

    Nothing changes for the caller in JavaScript. The browser serves the
    cached body with a 200 on a 304, so `fetch(...).then(r => r.json())` is
    untouched — the saving is entirely on the wire.
    """
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if matches_if_none_match(request, etag):
        # A 304 carries no body by definition; aiohttp enforces this.
        return web.Response(status=304, headers=headers)
    response = web.json_response(data)
    response.headers.update(headers)
    return response


def extract_referenced_uuids(payload: Any) -> set[str]:
    """Recursively scan strings inside `payload` for `@{8hex}` refs and
    return the set of unique uuids referenced.

    Used by the SPA Test Runner to determine which wildcards must be
    loaded from the library before resolution can proceed (lazy catalog,
    spec §2.10). Reuses the engine tokenizer so the regex shape stays
    locked in one place."""
    refs: set[str] = set()

    def _scan(value: Any) -> None:
        if isinstance(value, str):
            for tok in tokenize_text(value):
                if tok.kind == TokenKind.REF:
                    uuid = (tok.meta or {}).get("uuid")
                    if isinstance(uuid, str):
                        refs.add(uuid)
        elif isinstance(value, dict):
            for v in value.values():
                _scan(v)
        elif isinstance(value, list):
            for item in value:
                _scan(item)

    _scan(payload)
    return refs
