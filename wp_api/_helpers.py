"""Shared helpers for wp_api route handlers."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from engine.db.connection import get_connection


def db_conn(_request: web.Request):
    """Open a fresh SQLite connection per request.

    SQLite WAL mode + per-request connections avoids cross-task locking
    issues. Connections are short-lived and closed by the caller.
    """
    return get_connection()


def json_ok(data: Any, *, status: int = 200) -> web.Response:
    return web.json_response(data, status=status)


def json_error(message: str, *, status: int) -> web.Response:
    return web.json_response({"error": message}, status=status)
