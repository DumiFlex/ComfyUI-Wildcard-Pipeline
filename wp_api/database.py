"""/wp/api/database/* — read-only info + maintenance dispatch."""
from __future__ import annotations

from aiohttp import web

from engine.db.connection import resolve_db_path_with_source
from engine.db.info import gather_info
from wp_api._helpers import db_session, json_ok


async def get_info(request: web.Request) -> web.Response:
    db_path, source = resolve_db_path_with_source()
    with db_session(request) as conn:
        info = gather_info(conn, db_path, source=source)
    return json_ok(info)


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/database/info", get_info)
