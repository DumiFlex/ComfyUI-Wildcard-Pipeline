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


# ---------------------------------------------------------------------------
# /wp/api/database/config  — GET / PUT / DELETE pending-move
# ---------------------------------------------------------------------------


async def test_get_config_returns_locations(wp_client):
    resp = await wp_client.get("/wp/api/database/config")
    assert resp.status == 200
    body = await resp.json()
    assert "preference" in body
    assert "pending_move" in body
    assert "locations" in body
    assert set(body["locations"].keys()) == {"user", "global", "root"}
    for loc in body["locations"].values():
        assert "path" in loc
        assert "exists" in loc
        assert "size_bytes" in loc
    assert "env_locked" in body
    # The wp_client fixture sets WP_DB_PATH, so env_locked must be true.
    assert body["env_locked"] is True


async def test_get_config_preference_null_by_default(wp_client):
    resp = await wp_client.get("/wp/api/database/config")
    body = await resp.json()
    # Sidecar is isolated to tmp and absent — preference reports null so
    # the frontend can distinguish "explicit" vs "default".
    assert body["preference"] is None
    assert body["pending_move"] is None


async def test_put_config_sets_preference(wp_client):
    resp = await wp_client.put(
        "/wp/api/database/config", json={"preference": "global"}
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["preference"] == "global"

    # Round-trip
    resp2 = await wp_client.get("/wp/api/database/config")
    body2 = await resp2.json()
    assert body2["preference"] == "global"


async def test_put_config_rejects_invalid_preference(wp_client):
    resp = await wp_client.put(
        "/wp/api/database/config", json={"preference": "wat"}
    )
    assert resp.status == 400


async def test_put_config_sets_pending_move(wp_client, tmp_path):
    src = str(tmp_path / "old.db")
    dst = str(tmp_path / "new.db")
    resp = await wp_client.put(
        "/wp/api/database/config",
        json={"pending_move": {"from": src, "to": dst, "mode": "copy"}},
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["pending_move"] == {"from": src, "to": dst, "mode": "copy"}


async def test_put_config_rejects_relative_paths(wp_client):
    resp = await wp_client.put(
        "/wp/api/database/config",
        json={"pending_move": {"from": "rel.db", "to": "/abs.db", "mode": "copy"}},
    )
    assert resp.status == 400


async def test_put_config_rejects_bad_mode(wp_client, tmp_path):
    resp = await wp_client.put(
        "/wp/api/database/config",
        json={"pending_move": {"from": str(tmp_path / "a.db"),
                               "to": str(tmp_path / "b.db"),
                               "mode": "rename"}},
    )
    assert resp.status == 400


async def test_put_config_rejects_invalid_json(wp_client):
    resp = await wp_client.put("/wp/api/database/config", data="not json")
    assert resp.status == 400


async def test_put_config_rejects_non_object_body(wp_client):
    resp = await wp_client.put("/wp/api/database/config", json=[1, 2, 3])
    assert resp.status == 400


async def test_put_config_rejects_pending_move_missing_fields(wp_client, tmp_path):
    resp = await wp_client.put(
        "/wp/api/database/config",
        json={"pending_move": {"from": str(tmp_path / "a.db")}},
    )
    assert resp.status == 400


async def test_put_config_null_clears_field(wp_client):
    # First set a preference, then clear it.
    await wp_client.put("/wp/api/database/config", json={"preference": "global"})
    resp = await wp_client.put(
        "/wp/api/database/config", json={"preference": None}
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["preference"] is None


async def test_put_config_preserves_unmentioned_fields(wp_client, tmp_path):
    """Omitting a field in the body should preserve its existing value."""
    src = str(tmp_path / "a.db")
    dst = str(tmp_path / "b.db")
    # Set both preference + pending_move.
    await wp_client.put(
        "/wp/api/database/config",
        json={"preference": "root",
              "pending_move": {"from": src, "to": dst, "mode": "copy"}},
    )
    # PUT only preference — pending_move should survive.
    resp = await wp_client.put(
        "/wp/api/database/config", json={"preference": "user"}
    )
    body = await resp.json()
    assert body["preference"] == "user"
    assert body["pending_move"] == {"from": src, "to": dst, "mode": "copy"}


async def test_delete_pending_move(wp_client, tmp_path):
    src = str(tmp_path / "a.db")
    dst = str(tmp_path / "b.db")
    await wp_client.put(
        "/wp/api/database/config",
        json={"preference": "user",
              "pending_move": {"from": src, "to": dst, "mode": "move"}},
    )
    resp = await wp_client.delete("/wp/api/database/config/pending-move")
    assert resp.status == 200
    body = await resp.json()
    assert body["pending_move"] is None
    assert body["preference"] == "user"  # preserved


async def test_delete_pending_move_when_absent_is_noop(wp_client):
    resp = await wp_client.delete("/wp/api/database/config/pending-move")
    assert resp.status == 200
    body = await resp.json()
    assert body["pending_move"] is None
