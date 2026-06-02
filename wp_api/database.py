"""/wp/api/database/* — read-only info + maintenance dispatch."""
from __future__ import annotations

import json as _json

from aiohttp import web

from engine.db.connection import resolve_db_path_with_source
from engine.db.info import analyze, gather_info, integrity_check, run_migrations, vacuum
from wp_api._helpers import db_session, json_error, json_ok

_OPS = {
    "vacuum": vacuum,
    "integrity": integrity_check,
    "analyze": analyze,
    "migrate": run_migrations,
}


async def get_info(request: web.Request) -> web.Response:
    db_path, source = resolve_db_path_with_source()
    with db_session(request) as conn:
        info = gather_info(conn, db_path, source=source)
    return json_ok(info)


async def run_maintenance(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except _json.JSONDecodeError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)
    op = body.get("op")
    if op not in _OPS:
        return json_error(
            f"unknown op {op!r}; expected one of: {sorted(_OPS)}",
            status=400,
        )
    handler = _OPS[op]
    with db_session(request) as conn:
        result = handler(conn)
    # result already includes ok / op / duration_ms (+ op-specific keys)
    return json_ok(result)


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/database/info", get_info)
    router.add_post("/wp/api/database/maintenance", run_maintenance)
