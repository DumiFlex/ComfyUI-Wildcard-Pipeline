"""HTTP routes for the SPA Manager + extension API."""
from __future__ import annotations

from aiohttp import web

from wp_api import categories as _categories
from wp_api import modules as _modules


def register_routes(app: web.Application) -> None:
    """Mount all /wp + /wp/api/* routes on the given app."""
    _modules.register(app.router)
    _categories.register(app.router)
