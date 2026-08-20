"""Tests for the X-WP-Startup-Id response header — fingerprint of the
current ComfyUI process, used by the SPA to detect restarts and prompt
a stale-page refresh."""
from __future__ import annotations


async def test_response_includes_startup_id_header(wp_client):
    resp = await wp_client.get("/wp/api/database/info")
    assert resp.status == 200
    sid = resp.headers.get("X-WP-Startup-Id")
    assert isinstance(sid, str)
    assert len(sid) == 32  # uuid4 hex


async def test_startup_id_is_stable_within_process(wp_client):
    r1 = await wp_client.get("/wp/api/database/info")
    r2 = await wp_client.get("/wp/api/database/config")
    assert r1.headers.get("X-WP-Startup-Id") == r2.headers.get("X-WP-Startup-Id")


async def test_startup_id_present_on_error_responses(wp_client):
    """Header lands even when the endpoint returns 4xx."""
    resp = await wp_client.post(
        "/wp/api/database/maintenance", json={"op": "drop-tables"},
    )
    assert resp.status == 400
    assert "X-WP-Startup-Id" in resp.headers


async def test_startup_id_is_not_stamped_on_other_routes(aiohttp_client):
    """We are a guest in ComfyUI's application.

    The middleware is registered on the host app, so until 2026-08-06 it
    stamped the header on EVERY response the whole server sent — ComfyUI's own
    index, other extensions' routes, image outputs. A remote probe of `GET /`
    came back carrying it.

    This mounts a non-`/wp` route alongside ours and asserts we keep our hands
    off it.
    """
    from aiohttp import web

    import wp_api

    app = web.Application(middlewares=[wp_api._startup_id_middleware])

    async def foreign(_request):
        return web.json_response({"owner": "not us"})

    app.router.add_get("/api/extensions", foreign)
    app.router.add_get("/wp/api/mine", foreign)

    client = await aiohttp_client(app)

    theirs = await client.get("/api/extensions")
    assert theirs.status == 200
    assert "X-WP-Startup-Id" not in theirs.headers

    ours = await client.get("/wp/api/mine")
    assert "X-WP-Startup-Id" in ours.headers
