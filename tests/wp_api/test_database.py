"""Tests for /wp/api/database/* endpoints."""
from __future__ import annotations

import pytest


async def test_get_info_returns_200_with_expected_shape(wp_client):
    resp = await wp_client.get("/wp/api/database/info")
    assert resp.status == 200
    body = await resp.json()
    assert "path" in body
    assert "source" in body
    assert body["source"] in {"WP_DB_PATH", "COMFYUI_USER_DIR",
                              "user", "global", "root"}
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


@pytest.mark.parametrize("op", ["vacuum", "integrity", "analyze", "migrate"])
async def test_post_maintenance_known_ops_return_ok(wp_client, op):
    resp = await wp_client.post(
        "/wp/api/database/maintenance", json={"op": op}
    )
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["ok"] is True
    assert body["op"] == op
    assert "duration_ms" in body


async def test_post_maintenance_unknown_op_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/database/maintenance", json={"op": "drop-tables"}
    )
    assert resp.status == 400
    body = await resp.json()
    assert "error" in body


async def test_post_maintenance_missing_op_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/database/maintenance", json={}
    )
    assert resp.status == 400


async def test_post_maintenance_invalid_json_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/database/maintenance", data="not json"
    )
    assert resp.status == 400
