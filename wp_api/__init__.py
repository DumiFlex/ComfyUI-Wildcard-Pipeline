"""HTTP routes for the SPA Manager + extension API."""
from __future__ import annotations

import logging
import uuid

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

# Generated once per process import. Survives reloads of the same process
# (which don't happen in ComfyUI's normal lifecycle anyway) but flips on
# every fresh ComfyUI start. The SPA caches the first value it sees and
# compares on every subsequent response; mismatch = restart happened =
# show "page is stale, refresh" banner.
STARTUP_ID = uuid.uuid4().hex


@web.middleware
async def _startup_id_middleware(request: web.Request, handler):
    """Tag every /wp/api/* response with X-WP-Startup-Id."""
    response = await handler(request)
    if isinstance(response, web.StreamResponse):
        response.headers["X-WP-Startup-Id"] = STARTUP_ID
    return response


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

    # Tag every response with the process startup id so the SPA can
    # detect a ComfyUI restart and prompt the user to refresh stale tabs.
    # ``app.middlewares`` is an aiohttp FrozenList — mutable until the
    # app starts. Best-effort try/except so we degrade quietly if the
    # host has already frozen it (we lose the banner, not the API).
    try:
        app.middlewares.append(_startup_id_middleware)
    except RuntimeError:
        logger.warning("wildcard-pipeline: app middlewares already frozen, "
                       "stale-page detection disabled")

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
