"""aiohttp route setup for the wildcard pipeline manager SPA and API."""

from __future__ import annotations

from pathlib import Path

from aiohttp import web

from .routes.crud import (
    create_constraint_routes,
    create_pipeline_routes,
    create_wildcard_routes,
)
from .routes.preview import create_preview_routes
from .services.file_store import FileStore

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_WEB_DIST = Path(__file__).resolve().parent.parent / "web_dist"


def setup_routes(app: web.Application) -> None:
    """Register all API routes and the SPA catch-all.

    Called from WildcardPipelineExtension.on_load().
    API routes MUST be registered before the catch-all.
    """
    # -- File stores for each resource type -----------------------------------
    wildcard_store = FileStore(_DATA_DIR / "wildcards")
    constraint_store = FileStore(_DATA_DIR / "constraints")
    pipeline_store = FileStore(_DATA_DIR / "pipelines")

    # -- API routes (must come BEFORE catch-all) ------------------------------
    app.router.add_routes(create_wildcard_routes(wildcard_store))
    app.router.add_routes(create_constraint_routes(constraint_store))
    app.router.add_routes(create_pipeline_routes(pipeline_store))
    app.router.add_routes(create_preview_routes())

    # -- SPA static assets + catch-all (MUST be last) -------------------------
    if _WEB_DIST.is_dir():
        # Serve static assets (JS, CSS, images) from web_dist/assets/
        app.router.add_static("/wp/assets", _WEB_DIST / "assets", follow_symlinks=True)

    # Catch-all for SPA client-side routing — returns index.html
    app.router.add_get("/wp/{tail:.*}", _spa_catch_all)
    app.router.add_get("/wp", _spa_catch_all)


async def _spa_catch_all(request: web.Request) -> web.StreamResponse:
    """Serve the SPA ``index.html`` for all non-API ``/wp`` routes."""
    index = _WEB_DIST / "src" / "manager.html"
    if not index.is_file():
        raise web.HTTPNotFound(
            text="Manager SPA not built. Run: pnpm run build:manager"
        )
    return web.FileResponse(index)
