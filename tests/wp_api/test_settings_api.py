"""/wp/api/settings + /wp/api/database/backups/*."""
from __future__ import annotations

import os
from pathlib import Path

from engine import prefs
from engine.db import backups as bk


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
    assert entry.pop("pruned") == []
    assert entry["reason"] == "manual"
    assert set(entry) == {"name", "size", "created_at", "reason", "pinned", "note"}
    assert entry["note"] is None

    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["backups"] == [entry]

    resp = await wp_client.delete(f"/wp/api/database/backups/{entry['name']}")
    assert resp.status == 204
    resp = await wp_client.delete(f"/wp/api/database/backups/{entry['name']}")
    assert resp.status == 404


async def test_manual_backup_prunes_to_keep(wp_client):
    await wp_client.put("/wp/api/settings", json={"backups": {"keep": 2}})
    names = [(await (await wp_client.post("/wp/api/database/backups")).json())["name"]
             for _ in range(2)]
    resp = await wp_client.put(f"/wp/api/database/backups/{names[0]}/pin", json={"pinned": True})
    assert resp.status == 200
    assert (await resp.json())["pinned"] is True
    third = await (await wp_client.post("/wp/api/database/backups")).json()
    assert third["pruned"] == []
    fourth = await (await wp_client.post("/wp/api/database/backups")).json()
    assert fourth["pruned"] == [names[1]]
    listed = (await (await wp_client.get("/wp/api/database/backups")).json())["backups"]
    assert [b["name"] for b in listed] == [fourth["name"], third["name"], names[0]]


async def test_manual_backup_takes_a_note(wp_client):
    resp = await wp_client.post("/wp/api/database/backups", json={"note": " before the rework "})
    assert resp.status == 201
    assert (await resp.json())["note"] == "before the rework"
    assert (await wp_client.post("/wp/api/database/backups", json={"note": 3})).status == 400
    assert (await wp_client.post("/wp/api/database/backups", data="nope")).status == 400


async def test_pin_backup_validates(wp_client):
    entry = await (await wp_client.post("/wp/api/database/backups")).json()
    url = f"/wp/api/database/backups/{entry['name']}/pin"
    assert (await wp_client.put(url, json={"pinned": "yes"})).status == 400
    assert (await wp_client.put(url, data="nope")).status == 400
    missing = "/wp/api/database/backups/wildcard-pipeline-20200101-000000-manual.db/pin"
    assert (await wp_client.put(missing, json={"pinned": True})).status == 404
    resp = await wp_client.put(url, json={"pinned": False})
    assert (await resp.json())["pinned"] is False


async def test_delete_backup_traversal_is_404(wp_client):
    resp = await wp_client.delete("/wp/api/database/backups/..%2Fapi.db")
    assert resp.status == 404
    assert _db_path().exists()


def _category_names() -> list[str]:
    import sqlite3
    conn = sqlite3.connect(str(_db_path()))
    try:
        return [r[0] for r in conn.execute("SELECT name FROM module_categories ORDER BY name")]
    finally:
        conn.close()


def _add_category(name: str) -> None:
    import sqlite3
    conn = sqlite3.connect(str(_db_path()))
    with conn:
        conn.execute("INSERT INTO module_categories(id, name) VALUES (?, ?)", (name, name))
    conn.close()


async def test_restore_runs_live(wp_client):
    _add_category("kept")
    entry = await (await wp_client.post("/wp/api/database/backups")).json()
    _add_category("later")

    resp = await wp_client.post(
        "/wp/api/database/backups/restore", json={"name": entry["name"]},
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["restored"] == entry["name"]
    assert "pre-restore" in body["pre_restore"]
    assert _category_names() == ["kept"]  # no restart needed
    # The library is usable through the API straight away.
    resp = await wp_client.get("/wp/api/categories")
    assert resp.status == 200
    listing = await (await wp_client.get("/wp/api/database/backups")).json()
    assert listing["pending_restore"] is None
    assert {b["name"] for b in listing["backups"]} >= {entry["name"], body["pre_restore"]}


async def test_restore_refused_is_409(wp_client):
    import sqlite3
    entry = await (await wp_client.post("/wp/api/database/backups")).json()
    conn = sqlite3.connect(str(bk.backups_dir(_db_path()) / entry["name"]))
    with conn:
        conn.execute("INSERT INTO migrations(version, applied_at) VALUES (999, 'x')")
    conn.close()
    resp = await wp_client.post(
        "/wp/api/database/backups/restore", json={"name": entry["name"]},
    )
    assert resp.status == 409
    assert "newer version" in (await resp.json())["error"]


async def test_cancel_a_restore_an_older_build_staged(wp_client):
    entry = await (await wp_client.post("/wp/api/database/backups")).json()
    bk.stage_restore(_db_path(), entry["name"])
    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["pending_restore"] == entry["name"]

    resp = await wp_client.delete("/wp/api/database/backups/restore")
    assert resp.status == 200
    assert await resp.json() == {"pending_restore": None}
    body = await (await wp_client.get("/wp/api/database/backups")).json()
    assert body["pending_restore"] is None


async def test_restore_unknown_is_404(wp_client):
    resp = await wp_client.post(
        "/wp/api/database/backups/restore",
        json={"name": "wildcard-pipeline-20260101-000000-manual.db"},
    )
    assert resp.status == 404
    resp = await wp_client.post(
        "/wp/api/database/backups/restore", json={"name": "../api.db"},
    )
    assert resp.status == 404


async def test_restore_bad_body_is_400(wp_client):
    resp = await wp_client.post("/wp/api/database/backups/restore", json={})
    assert resp.status == 400
    resp = await wp_client.post("/wp/api/database/backups/restore", data="x")
    assert resp.status == 400
