"""Shared aiohttp test fixtures for /wp/api/* endpoints."""
import pytest
from aiohttp import web

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from tests.wp_api._ai_fakes import _isolated_ai, fake_llm  # noqa: F401 - AI fixtures
from wp_api import register_routes


@pytest.fixture
def db_conn(tmp_path):
    """In-memory (well, tmp-file) migrated SQLite connection for repository tests."""
    conn = get_connection(tmp_path / "repo_test.db")
    migrate(conn)
    yield conn
    conn.close()


@pytest.fixture
def wp_app(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "api.db"))
    # Isolate the sidecar so PUT/DELETE config tests don't touch the real
    # <plugin>/db-config.json. Patch BEFORE register_routes() runs because
    # register_routes() calls execute_pending_move() which reads the sidecar.
    monkeypatch.setattr(
        "engine.db.config.SIDECAR_PATH",
        tmp_path / "db-config.json",
    )
    conn = get_connection()
    migrate(conn)
    conn.close()

    app = web.Application()
    register_routes(app)
    return app


@pytest.fixture
async def wp_client(wp_app, aiohttp_client):
    return await aiohttp_client(wp_app)


@pytest.fixture
def items_planner(monkeypatch):
    """The item-list planner (the model writes every item and payload), for
    tests written against it; packs default to the graph planner."""
    from engine.ai.pack import settings as pack_settings
    monkeypatch.setitem(pack_settings.DEFAULT_SETTINGS, "planner", "items")

