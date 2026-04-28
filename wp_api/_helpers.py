"""Shared helpers for wp_api route handlers."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any

from aiohttp import web

from engine.db.connection import get_connection
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind


@contextmanager
def db_session(_request: web.Request):
    """Yield a fresh SQLite connection that is auto-closed on exit.

    SQLite WAL mode + per-request connections avoid cross-task locking.
    """
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def json_ok(data: Any, *, status: int = 200) -> web.Response:
    return web.json_response(data, status=status)


def json_error(message: str, *, status: int) -> web.Response:
    return web.json_response({"error": message}, status=status)


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
