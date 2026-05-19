"""Tests for /wp + /wp/{path:.*} static + SPA fallback behavior."""
import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture
def stub_web_dir(tmp_path, monkeypatch):
    """Provide a temporary `web/` directory with a minimal index.html.

    The real WEB_DIR points at the build output (`web/index.html` + js
    bundle) which lives next to `wp_api/`. CI runs without a frontend
    build, so the directory doesn't exist — every static-serve test
    would hit a FileNotFoundError. Monkeypatch `WEB_DIR` to a tmp path
    that we populate with a stub index so the SPA-fallback handler has
    something to serve.
    """
    from wp_api import spa as spa_mod
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    (web_dir / "index.html").write_text(
        "<!doctype html><html><head><title>Wildcard Pipeline</title></head>"
        "<body><div id=\"app\"></div></body></html>",
        encoding="utf-8",
    )
    monkeypatch.setattr(spa_mod, "WEB_DIR", web_dir)
    return web_dir


async def test_root_serves_index_html(wp_client, stub_web_dir):
    resp = await wp_client.get("/wp")
    assert resp.status == 200
    body = await resp.text()
    assert "<title>" in body.lower()
    assert "wildcard pipeline" in body.lower()


async def test_unknown_path_falls_back_to_index_html(wp_client, stub_web_dir):
    resp = await wp_client.get("/wp/modules/some-future-route")
    assert resp.status == 200
    body = await resp.text()
    assert "<title>" in body.lower()


async def test_static_asset_served_when_present(wp_client, stub_web_dir):
    """Static files in WEB_DIR are served as-is, not as the SPA shell."""
    asset = stub_web_dir / "favicon.txt"
    asset.write_text("hello", encoding="utf-8")
    resp = await wp_client.get("/wp/favicon.txt")
    assert resp.status == 200
    assert (await resp.text()) == "hello"


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


async def test_unknown_api_path_returns_json_404(wp_client):
    """Unknown `/wp/api/...` paths must NOT fall through to the SPA shell.

    Pre-fix `GET /wp/api/this/does/not/exist` returned 200 text/html
    (the SPA index), making client-side debugging hostile — the
    JSON.parse failure masked the real "no such route" error.
    """
    resp = await wp_client.get("/wp/api/this/path/does/not/exist")
    assert resp.status == 404
    assert resp.headers.get("Content-Type", "").startswith("application/json")
    body = await resp.json()
    assert "error" in body
