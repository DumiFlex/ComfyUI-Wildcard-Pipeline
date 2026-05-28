"""Tests for POST /wp/api/import/commit — Task 14 / importer-exporter v2.

Endpoint wraps ``engine.importer.commit_import``. Body buckets ``adds``,
``replaces``, ``renames`` are applied atomically. Success returns
``{"ok": True, "undo_entry_id": str, "summary": {...}}`` with status
200; contract violations and wrapped DB errors return
``{"error": str}`` with status 400.
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


def _bundle_entity(id_: str, name: str = "pack") -> dict:
    return {
        "id": id_,
        "name": name,
        "description": "",
        "color": None,
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "children": [],
        "version": 1,
    }


def _category_entity(id_: str, name: str) -> dict:
    return {
        "id": id_, "name": name, "color": None, "icon": None, "sort_order": 0,
    }


def _template_entity(id_: str, name: str = "tpl") -> dict:
    return {
        "id": id_, "name": name, "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "template_string": "$subject, $style",
    }


async def _seed_wildcard(wp_client, name: str = "seed") -> dict:
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": name, "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    assert resp.status == 201
    return await resp.json()


async def _seed_category(wp_client, name: str = "Style") -> dict:
    resp = await wp_client.post("/wp/api/categories", json={
        "name": name, "color": None, "icon": None,
    })
    assert resp.status == 201
    return await resp.json()


# ── Happy paths ───────────────────────────────────────────────────────────


async def test_commit_add_wildcard(wp_client):
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "wildcard", "entity": _wildcard_entity("aabbccdd")}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert isinstance(body["undo_entry_id"], str)
    assert body["undo_entry_id"]  # non-empty

    # Confirm the module landed in the DB at the supplied id.
    g = await wp_client.get("/wp/api/modules/aabbccdd")
    assert g.status == 200
    row = await g.json()
    assert row["type"] == "wildcard"
    assert row["name"] == "color"


async def test_commit_replace_wildcard(wp_client):
    seed = await _seed_wildcard(wp_client, name="before")
    sid = seed["id"]
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [],
        "replaces": [{
            "kind": "wildcard",
            "id": sid,
            "new_content": {
                "name": "after",
                "description": "renamed via commit",
                "category_id": None,
                "tags": ["edited"],
                "is_favorite": False,
                "payload": {"options": [{"id": "r", "value": "red", "weight": 1}]},
                "version": 1,
            },
        }],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True

    g = await wp_client.get(f"/wp/api/modules/{sid}")
    assert g.status == 200
    row = await g.json()
    assert row["name"] == "after"
    assert row["description"] == "renamed via commit"
    assert row["tags"] == ["edited"]


async def test_commit_add_bundle(wp_client):
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "bundle", "entity": _bundle_entity("ccddee11", name="pack")}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert body["undo_entry_id"]

    g = await wp_client.get("/wp/api/bundles/ccddee11")
    assert g.status == 200
    row = await g.json()
    assert row["name"] == "pack"


async def test_commit_add_template(wp_client):
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "template", "entity": _template_entity("ttee1122")}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert body["undo_entry_id"]

    g = await wp_client.get("/wp/api/templates/ttee1122")
    assert g.status == 200
    row = await g.json()
    assert row["name"] == "tpl"
    assert row["template_string"] == "$subject, $style"


async def test_commit_add_category_name_merge(wp_client):
    """Pre-seed category with name 'Style' (id derived: 'style'). Commit
    another 'Style'-named category at a different id. Engine's name-based
    merge collapses it — no new row, no error."""
    await _seed_category(wp_client, name="Style")
    # Sanity: one category present pre-commit.
    listing = await (await wp_client.get("/wp/api/categories")).json()
    assert len(listing["items"]) == 1

    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{
            "kind": "category",
            "entity": _category_entity("other_id", "STYLE"),  # case-insensitive
        }],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True

    # Still exactly one category — the engine recorded a skip, not an insert.
    after = await (await wp_client.get("/wp/api/categories")).json()
    assert len(after["items"]) == 1


async def test_commit_add_fixed_values_module(wp_client):
    """Smoke test for a non-wildcard module kind — exercises the
    `_is_module_kind` dispatch for fixed_values through the handler."""
    entity = {
        "id": "fff10001", "type": "fixed_values", "name": "fv",
        "description": "", "category_id": None, "tags": [],
        "is_favorite": False,
        "payload": {"values": [{"id": "v1", "name": "lens", "value": "wide"}]},
        "version": 1,
    }
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "fixed_values", "entity": entity}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True

    g = await wp_client.get("/wp/api/modules/fff10001")
    assert g.status == 200
    row = await g.json()
    assert row["type"] == "fixed_values"


# ── Validation ────────────────────────────────────────────────────────────


async def test_commit_invalid_json_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/import/commit",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_commit_non_object_body_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/import/commit", json=["x"])
    assert resp.status == 400


async def test_commit_non_list_bucket_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": "not a list",
    })
    assert resp.status == 400
    body = await resp.json()
    assert "adds" in body["error"]


# ── Contract violations → 400 ─────────────────────────────────────────────


async def test_commit_missing_entity_field_returns_400(wp_client):
    """Wildcard add missing 'name' — engine raises _ImporterContractError."""
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "wildcard", "entity": {"id": "aabbccdd"}}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 400
    body = await resp.json()
    # Message should name the missing field rather than leaking SQL.
    assert "name" in body["error"]
    assert "wildcard" in body["error"]


async def test_commit_id_collision_on_add_returns_400(wp_client):
    """Pre-seed a module then commit an add at the same id."""
    seed = await _seed_wildcard(wp_client)
    sid = seed["id"]
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "wildcard", "entity": _wildcard_entity(sid)}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 400
    body = await resp.json()
    assert "collision" in body["error"]
    # The colliding id must appear in the message so the SPA can highlight it.
    assert sid in body["error"]


async def test_commit_unknown_kind_returns_400(wp_client):
    """Garbage kind values trip the unknown-kind branch in the engine."""
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [{"kind": "nonsense", "entity": _wildcard_entity("aabbccdd")}],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 400
    body = await resp.json()
    assert "unknown kind" in body["error"]


async def test_commit_rolls_back_on_partial_failure(wp_client):
    """Two adds in one commit; the second collides. The first must
    NOT land — the engine's `with conn:` rolls back the whole batch."""
    resp = await wp_client.post("/wp/api/import/commit", json={
        "adds": [
            {"kind": "wildcard", "entity": _wildcard_entity("11112222")},
            # Same id collides with the first — triggers rollback.
            {"kind": "wildcard", "entity": _wildcard_entity("11112222", name="dup")},
        ],
        "replaces": [],
        "renames": [],
    })
    assert resp.status == 400
    # Confirm the first add was rolled back.
    g = await wp_client.get("/wp/api/modules/11112222")
    assert g.status == 404
