"""HTTP routes for the SPA Manager + extension API."""
from __future__ import annotations

import logging

from aiohttp import web

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.pending_move import execute_pending_move
from wp_api import bundles as _bundles
from wp_api import cascade as _cascade
from wp_api import categories as _categories
from wp_api import database as _database
from wp_api import import_export as _import_export
from wp_api import modules as _modules
from wp_api import preview as _preview
from wp_api import spa as _spa
from wp_api import templates as _templates
from wp_api import test_runner as _test_runner

logger = logging.getLogger(__name__)


def _ensure_db_migrated() -> None:
    """Run pending migrations on the configured DB. Idempotent."""
    conn = get_connection()
    try:
        migrate(conn)
    finally:
        conn.close()


def register_routes(app: web.Application) -> None:
    """Mount all /wp + /wp/api/* routes on the given app."""
    # Pending-move runs FIRST: the file operation must complete before
    # any DB connection opens, otherwise the migration step below would
    # operate on the wrong file (or an empty new file while the user's
    # data still sits at the old location).
    try:
        execute_pending_move()
    except Exception:  # noqa: BLE001 - never crash ComfyUI on pending-move failure
        logger.exception("wildcard-pipeline: pending db move failed")
    try:
        _ensure_db_migrated()
    except Exception:  # noqa: BLE001 - never crash ComfyUI on migration failure
        logger.exception("wildcard-pipeline: db migration failed")

    _modules.register(app.router)
    _bundles.register(app.router)
    _templates.register(app.router)
    _categories.register(app.router)
    _database.register(app.router)
    _test_runner.register(app.router)
    _import_export.register(app.router)
    _cascade.register(app.router)
    _preview.register(app.router)
    # SPA fallback last — broad catch-all `/wp/{path:.*}` must not shadow
    # specific `/wp/api/...` routes. aiohttp resolves more-specific routes
    # first regardless of registration order, but late registration keeps
    # intent obvious.
    _spa.register(app.router)
