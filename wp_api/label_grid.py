"""`/wp/api/label-grid/*` — what the WP Label & Grid widget asks the server.

Only the font list today: the widget's font picker shows the fonts this
machine has (the extension's ``fonts/`` folder, then the system's).
"""

from __future__ import annotations

from aiohttp import web

from engine import label_grid as _g
from wp_api._helpers import json_ok


async def get_fonts(_request: web.Request) -> web.Response:
    """GET /wp/api/label-grid/fonts — ``{fonts: ["default", "Arial.ttf", …]}``."""
    return json_ok({"fonts": _g.list_fonts()})


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/label-grid/fonts", get_fonts)
