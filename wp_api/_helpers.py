"""Shared helpers for wp_api route handlers."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any

from aiohttp import web

from engine.db.connection import get_connection


def db_conn(_request: web.Request):
    """Open a fresh SQLite connection per request.

    Kept for backward-compat; new code should prefer ``db_session()``.
    """
    return get_connection()


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
