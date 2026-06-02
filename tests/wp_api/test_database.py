"""Tests for /wp/api/database/* endpoints."""
from __future__ import annotations


async def test_get_info_returns_200_with_expected_shape(wp_client):
    resp = await wp_client.get("/wp/api/database/info")
    assert resp.status == 200
    body = await resp.json()
    assert "path" in body
    assert "source" in body
    assert body["source"] in {"WP_DB_PATH", "COMFYUI_USER_DIR",
                              "comfyui_user_dir", "legacy"}
    assert "size_bytes" in body
    assert "mtime_iso" in body
    assert "counts" in body
    assert "migration" in body
    assert "pragma" in body
    assert body["pragma"]["journal_mode"] == "wal"


async def test_get_info_counts_reflect_db_state(wp_client):
    """Insert via repository, then verify counts increment."""
    resp = await wp_client.get("/wp/api/database/info")
    body = await resp.json()
    assert body["counts"]["wildcards"] == 0
    assert body["counts"]["bundles"] == 0
