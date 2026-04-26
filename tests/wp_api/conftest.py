"""Shared aiohttp test fixtures for /wp/api/* endpoints."""
import pytest
from aiohttp import web

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from wp_api import register_routes


@pytest.fixture
def wp_app(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "api.db"))
    conn = get_connection()
    migrate(conn)
    conn.close()

    app = web.Application()
    register_routes(app)
    return app


@pytest.fixture
async def wp_client(wp_app, aiohttp_client):
    return await aiohttp_client(wp_app)
