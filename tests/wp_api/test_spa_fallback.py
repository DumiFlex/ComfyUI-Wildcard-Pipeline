"""Tests for /wp + /wp/{path:.*} static + SPA fallback behavior."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_root_serves_index_html(wp_client):
    resp = await wp_client.get("/wp")
    assert resp.status == 200
    body = await resp.text()
    assert "<title>" in body.lower()
    assert "wildcard pipeline" in body.lower()


async def test_unknown_path_falls_back_to_index_html(wp_client):
    resp = await wp_client.get("/wp/modules/some-future-route")
    assert resp.status == 200
    body = await resp.text()
    assert "<title>" in body.lower()


async def test_static_asset_served_when_present(wp_client, tmp_path):
    """Static files in WEB_DIR are served as-is, not as the SPA shell."""
    from wp_api import spa as spa_mod
    asset = spa_mod.WEB_DIR / "favicon.txt"
    asset.write_text("hello", encoding="utf-8")
    try:
        resp = await wp_client.get("/wp/favicon.txt")
        assert resp.status == 200
        assert (await resp.text()) == "hello"
    finally:
        asset.unlink()


async def test_path_traversal_blocked(wp_client):
    """Requests with .. in the path must not escape WEB_DIR."""
    resp = await wp_client.get("/wp/../pyproject.toml")
    # aiohttp's router normalizes path traversal before reaching the handler;
    # the request resolves to /pyproject.toml which is not registered → 404.
    # If it ever reaches our handler, the resolve check returns 403.
    assert resp.status in (403, 404)


async def test_api_routes_not_shadowed(wp_client):
    """The catch-all /wp/{path:.*} must not shadow specific /wp/api/* routes."""
    resp = await wp_client.get("/wp/api/modules")
    assert resp.status == 200
    body = await resp.json()
    assert "items" in body
