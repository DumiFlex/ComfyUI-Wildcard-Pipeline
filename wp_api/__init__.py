"""HTTP routes for the SPA Manager + extension API."""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from aiohttp import web

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.pending_move import execute_pending_move
from wp_api import bundles as _bundles
from wp_api import cascade as _cascade
from wp_api import categories as _categories
from wp_api import database as _database
from wp_api import import_export as _import_export
from wp_api import models as _models
from wp_api import modules as _modules
from wp_api import preview as _preview
from wp_api import scenarios as _scenarios
from wp_api import spa as _spa
from wp_api import tags as _tags
from wp_api import templates as _templates
from wp_api import test_runner as _test_runner

logger = logging.getLogger(__name__)

# Generated once per process import. Survives reloads of the same process
# (which don't happen in ComfyUI's normal lifecycle anyway) but flips on
# every fresh ComfyUI start. The SPA caches the first value it sees and
# compares on every subsequent response; mismatch = restart happened =
# show "page is stale, refresh" banner.
STARTUP_ID = uuid.uuid4().hex


def _read_installed_version() -> str:
    """The pack version on disk when this process started (`pyproject.toml`).

    An update only takes effect on the backend after a restart, but a browser
    tab keeps running the JS it loaded before. Stamping this lets the SPA and
    the canvas notice they're older than the installed pack and ask for a
    refresh. Regex rather than tomllib so Python 3.10 works too.
    """
    try:
        text = (Path(__file__).resolve().parent.parent / "pyproject.toml").read_text("utf-8")
    except OSError:
        return ""
    m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    return m.group(1) if m else ""


INSTALLED_VERSION = _read_installed_version()


@web.middleware
async def _startup_id_middleware(request: web.Request, handler):
    """Tag our own responses with X-WP-Startup-Id and X-WP-Version.

    The path check is load-bearing and was missing until 2026-08-06. This
    middleware is registered on ComfyUI's application, not on a sub-app, so
    without it every response the whole server sends carried the header —
    ComfyUI's own index, `/api/extensions`, image outputs, other extensions'
    routes. Confirmed by a remote probe: `GET /` came back stamped.

    Nothing depended on that: the only consumer is `manager/api/client.ts`,
    which talks exclusively to `/wp/api/*`. Being a guest in someone else's
    application means not writing on their responses — see CLAUDE.md's
    extension-isolation section, which draws the same line for CSS selectors
    and litegraph node properties.
    """
    response = await handler(request)
    is_ours = request.path == "/wp" or request.path.startswith("/wp/")
    if is_ours and isinstance(response, web.StreamResponse):
        response.headers["X-WP-Startup-Id"] = STARTUP_ID
        if INSTALLED_VERSION:
            response.headers["X-WP-Version"] = INSTALLED_VERSION
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
    _scenarios.register(app.router)
    _import_export.register(app.router)
    _cascade.register(app.router)
    _preview.register(app.router)
    _tags.register(app.router)
    _models.register(app.router)
    # SPA fallback last — broad catch-all `/wp/{path:.*}` must not shadow
    # specific `/wp/api/...` routes. aiohttp resolves more-specific routes
    # first regardless of registration order, but late registration keeps
    # intent obvious.
    _spa.register(app.router)
