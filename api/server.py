"""aiohttp route setup for the wildcard pipeline API."""

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


def setup_routes(app: web.Application) -> None:
    """Register all API routes.

    Called from WildcardPipelineExtension.on_load().
    """
    # -- File stores for each resource type -----------------------------------
    wildcard_store = FileStore(_DATA_DIR / "wildcards")
    constraint_store = FileStore(_DATA_DIR / "constraints")
    pipeline_store = FileStore(_DATA_DIR / "pipelines")

    # -- API routes -----------------------------------------------------------
    app.router.add_routes(create_wildcard_routes(wildcard_store))
    app.router.add_routes(create_constraint_routes(constraint_store))
    app.router.add_routes(create_pipeline_routes(pipeline_store))
    app.router.add_routes(create_preview_routes())

    # -- SPA disabled (dashboard under development on dashboard-remake branch) --
