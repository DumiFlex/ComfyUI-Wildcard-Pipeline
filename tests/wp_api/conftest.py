"""Shared aiohttp test fixtures for /wp/api/* endpoints."""
import pytest
from aiohttp import web

from engine.db.connection import get_connection
from engine.db.migrations import migrate
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
