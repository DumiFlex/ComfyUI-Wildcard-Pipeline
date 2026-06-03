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
