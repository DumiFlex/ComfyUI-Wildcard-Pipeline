"""/wp/api/settings + /wp/api/database/backups/*."""
from __future__ import annotations

import os
from pathlib import Path

from engine import prefs
from engine.db import backups as bk
from engine.db import config as dbcfg


def _db_path() -> Path:
    return Path(os.environ["WP_DB_PATH"])


# ── settings ─────────────────────────────────────────────────────────

async def test_get_settings_defaults(wp_client):
    resp = await wp_client.get("/wp/api/settings")
    assert resp.status == 200
    assert await resp.json() == {
        "max_ref_depth": 8,
        "backups": {"enabled": True, "keep": 7, "daily": True},
    }


async def test_put_settings_partial_merge(wp_client):
    resp = await wp_client.put("/wp/api/settings", json={"backups": {"keep": 3}})
    assert resp.status == 200
    body = await resp.json()
    assert body["backups"] == {"enabled": True, "keep": 3, "daily": True}
    resp = await wp_client.put("/wp/api/settings", json={"max_ref_depth": 100})
    body = await resp.json()
    assert body["max_ref_depth"] == 32
    assert body["backups"]["keep"] == 3
    assert prefs.load() == body


async def test_put_settings_rejects_non_object(wp_client):
    resp = await wp_client.put("/wp/api/settings", json=[1, 2])
    assert resp.status == 400
    resp = await wp_client.put("/wp/api/settings", data="nope")
    assert resp.status == 400


# ── backups ──────────────────────────────────────────────────────────

async def test_list_backups_empty(wp_client):
    resp = await wp_client.get("/wp/api/database/backups")
    assert resp.status == 200
    body = await resp.json()
    assert body == {
        "dir": str(_db_path().parent / "backups"),
        "backups": [],
        "pending_restore": None,
    }


async def test_create_list_delete_backup(wp_client):
    resp = await wp_client.post("/wp/api/database/backups")
    assert resp.status == 201
    entry = await resp.json()
    assert entry["reason"] == "manual"
    assert set(entry) == {"name", "size", "created_at", "reason"}

    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["backups"] == [entry]

    resp = await wp_client.delete(f"/wp/api/database/backups/{entry['name']}")
    assert resp.status == 204
    resp = await wp_client.delete(f"/wp/api/database/backups/{entry['name']}")
    assert resp.status == 404


async def test_delete_backup_traversal_is_404(wp_client):
    resp = await wp_client.delete("/wp/api/database/backups/..%2Fapi.db")
    assert resp.status == 404
    assert _db_path().exists()


async def test_stage_and_cancel_restore(wp_client):
    entry = await (await wp_client.post("/wp/api/database/backups")).json()
    resp = await wp_client.post(
        "/wp/api/database/backups/restore", json={"name": entry["name"]},
    )
    assert resp.status == 200
    assert await resp.json() == {"pending_restore": entry["name"]}
    assert dbcfg.load()["pending_restore"]["from"] == str(
        (bk.backups_dir(_db_path()) / entry["name"]).resolve()
    )
    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["pending_restore"] == entry["name"]

    resp = await wp_client.delete("/wp/api/database/backups/restore")
    assert resp.status == 200
    assert await resp.json() == {"pending_restore": None}
    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["pending_restore"] is None


async def test_stage_restore_unknown_is_404(wp_client):
    resp = await wp_client.post(
        "/wp/api/database/backups/restore",
        json={"name": "wildcard-pipeline-20260101-000000-manual.db"},
    )
    assert resp.status == 404
    resp = await wp_client.post(
        "/wp/api/database/backups/restore", json={"name": "../api.db"},
    )
    assert resp.status == 404


async def test_stage_restore_bad_body_is_400(wp_client):
    resp = await wp_client.post("/wp/api/database/backups/restore", json={})
    assert resp.status == 400
    resp = await wp_client.post("/wp/api/database/backups/restore", data="x")
    assert resp.status == 400
