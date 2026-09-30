"""/wp/api/settings — server-side preferences (see `engine/prefs.py`).

Settings that the server acts on (the `@{uuid}` recursion limit, database
backups) live here rather than in the browser, so every surface — canvas
runs, preview, Test Runner, boot-time backups — reads the same value.
"""
from __future__ import annotations

import json as _json

from aiohttp import web

from engine import prefs
from wp_api._helpers import json_error, json_ok


async def get_settings(request: web.Request) -> web.Response:
    return json_ok(prefs.load())


async def put_settings(request: web.Request) -> web.Response:
    """Deep-merge a partial body. Invalid values are clamped or replaced by
    defaults (engine/prefs.py:normalize) rather than rejected, and the full
    resulting shape is returned so the client can show what actually stuck."""
    try:
        body = await request.json()
    except _json.JSONDecodeError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)
    try:
        return json_ok(prefs.update(body))
    except OSError as e:
        return json_error(f"could not save settings: {e}", status=500)


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/settings", get_settings)
    router.add_put("/wp/api/settings", put_settings)
