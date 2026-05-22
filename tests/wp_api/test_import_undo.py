"""Tests for POST /wp/api/import/undo — Task 14 / importer-exporter v2.

Endpoint wraps ``engine.importer.undo_import``. Body shape:
``{"undo_entry_id": str}``. Success returns ``{"ok": True}`` (200).
Missing / non-string ``undo_entry_id`` → 400. Unknown
``undo_entry_id`` → **404** (clean miss). Other engine failures → 400.
"""
import pytest

pytestmark = pytest.mark.asyncio


# ── helpers ────────────────────────────────────────────────────────────────


def _wildcard_entity(id_: str, name: str = "color") -> dict:
    return {
        "id": id_,
        "type": "wildcard",
        "name": name,
        "description": "",
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "payload": {"options": [{"id": "r", "value": "red", "weight": 1}]},
        "version": 1,
    }


async def _seed_wildcard(wp_client, name: str = "seed") -> dict:
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": name, "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    assert resp.status == 201
    return await resp.json()


async def _commit_add(wp_client, entity: dict, kind: str = "wildcard") -> str:
    """Commit an add, return the resulting undo_entry_id."""
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": kind, "entity": entity}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    return body["undo_entry_id"]


# ── Happy paths ───────────────────────────────────────────────────────────


async def test_undo_reverses_add(wp_client):
    undo_id = await _commit_add(wp_client, _wildcard_entity("aabbccdd"))
    # Sanity: module present before undo.
    g = await wp_client.get("/wp/api/modules/aabbccdd")
    assert g.status == 200

    resp = await wp_client.post("/wp/api/import/undo", json={
        "undo_entry_id": undo_id,
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True

    # Confirm the module is gone.
    g2 = await wp_client.get("/wp/api/modules/aabbccdd")
    assert g2.status == 404


async def test_undo_restores_replaced_content(wp_client):
    seed = await _seed_wildcard(wp_client, name="original")
    sid = seed["id"]
    original_desc = seed.get("description", "")
    original_tags = seed.get("tags", [])

    # Replace the module — the previous content goes into the undo snapshot.
    commit_resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [],
        "replaces": [{
            "kind": "wildcard",
            "id": sid,
            "new_content": {
                "name": "mutated",
                "description": "was changed",
                "category_id": None,
                "tags": ["mutated"],
                "is_favorite": False,
                "payload": {"options": []},
                "version": 1,
            },
        }],
        "renames": [],
    })
    assert commit_resp.status == 200
    undo_id = (await commit_resp.json())["undo_entry_id"]

    # Pre-undo state reflects the replace.
    mid_state = await (await wp_client.get(f"/wp/api/modules/{sid}")).json()
    assert mid_state["name"] == "mutated"

    # Undo and verify the pre-replace state is bit-restored.
    undo_resp = await wp_client.post("/wp/api/import/undo", json={
        "undo_entry_id": undo_id,
    })
    assert undo_resp.status == 200
    body = await undo_resp.json()
    assert body["ok"] is True

    restored = await (await wp_client.get(f"/wp/api/modules/{sid}")).json()
    assert restored["name"] == "original"
    assert restored["description"] == original_desc
    assert restored["tags"] == original_tags


# ── Validation ────────────────────────────────────────────────────────────


async def test_undo_invalid_json_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/import/undo",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_undo_non_object_body_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/import/undo", json=["x"])
    assert resp.status == 400


async def test_undo_missing_field_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/import/undo", json={})
    assert resp.status == 400
    body = await resp.json()
    assert "required" in body["error"]


async def test_undo_non_string_id_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/import/undo", json={
        "undo_entry_id": 123,
    })
    assert resp.status == 400
    body = await resp.json()
    assert "string" in body["error"]


# ── Missing entry → 404 (clean miss) ──────────────────────────────────────


async def test_undo_unknown_entry_id_returns_404(wp_client):
    resp = await wp_client.post("/wp/api/import/undo", json={
        "undo_entry_id": "doesnotexist",
    })
    assert resp.status == 404
    body = await resp.json()
    assert "not found" in body["error"]
