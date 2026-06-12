"""HTTP tests for /wp/api/cascade/apply + /wp/api/cascade/undo."""
import pytest

pytestmark = pytest.mark.asyncio


# ── helpers ────────────────────────────────────────────────────────────────


def _wildcard_entity(id_: str, name: str = "test") -> dict:
    return {
        "id": id_,
        "type": "wildcard",
        "name": name,
        "description": "",
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "payload": {"options": []},
        "version": 1,
    }


# ── tests ──────────────────────────────────────────────────────────────────


async def test_cascade_apply_dry_run(wp_client):
    """Dry-run returns affected list without mutating."""
    # Create a wildcard to delete.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard",
        "name": "test_wc",
        "description": "",
        "category_id": None,
        "tags": [],
        "payload": {"options": []},
    })
    assert resp.status == 201
    wc = await resp.json()
    wc_id = wc["id"]

    # Dry-run cascade apply.
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard",
        "id": wc_id,
        "action": "delete",
        "dry_run": True,
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert body["affected_count"] >= 0
    assert "affected_entities" in body


async def test_cascade_apply_commit_returns_undo_id(wp_client):
    """Commit mode returns undo_entry_id + diff."""
    # Create a wildcard to delete.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard",
        "name": "test_wc",
        "description": "",
        "category_id": None,
        "tags": [],
        "payload": {"options": []},
    })
    assert resp.status == 201
    wc = await resp.json()
    wc_id = wc["id"]

    # Cascade apply with commit.
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard",
        "id": wc_id,
        "action": "delete",
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert "undo_entry_id" in body
    assert body["undo_entry_id"]  # not empty
    assert "diff" in body


async def test_cascade_apply_cleanup_ids_strips_nested_ref(wp_client):
    """cleanup_ids in the request body reaches apply_cascade end-to-end:
    a nested-ref wildcard whose id IS in cleanup_ids gets its @{deleted}
    token stripped; one whose id is omitted keeps the (now dead) ref."""
    # Target wildcard to delete.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "target", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    assert resp.status == 201
    target_id = (await resp.json())["id"]
    ref = "@{" + target_id + "}"

    # Wildcard whose option value nests a ref to the target — gets cleaned.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "cleaned", "description": "",
        "category_id": None, "tags": [],
        "payload": {"options": [{"id": "o1", "value": "warm " + ref + " glow", "weight": 1}]},
    })
    assert resp.status == 201
    cleaned_id = (await resp.json())["id"]

    # Wildcard with the same ref but omitted from cleanup_ids — left broken.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "kept", "description": "",
        "category_id": None, "tags": [],
        "payload": {"options": [{"id": "o2", "value": "cool " + ref + " shade", "weight": 1}]},
    })
    assert resp.status == 201
    kept_id = (await resp.json())["id"]

    # Apply with only `cleaned_id` in cleanup_ids.
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard", "id": target_id, "action": "delete",
        "cleanup_ids": [cleaned_id],
    })
    assert resp.status == 200
    assert (await resp.json())["ok"] is True

    # cleaned: ref stripped (proves cleanup_ids flowed to the engine).
    resp = await wp_client.get(f"/wp/api/modules/{cleaned_id}")
    cleaned_val = (await resp.json())["payload"]["options"][0]["value"]
    assert "@{" not in cleaned_val

    # kept: ref intact (not in cleanup_ids → engine left it broken).
    resp = await wp_client.get(f"/wp/api/modules/{kept_id}")
    kept_val = (await resp.json())["payload"]["options"][0]["value"]
    assert ref in kept_val


async def test_cascade_apply_rejects_non_dict_body(wp_client):
    """Non-dict body returns 400."""
    resp = await wp_client.post("/wp/api/cascade/apply", data="not json")
    assert resp.status == 400


async def test_cascade_apply_rejects_missing_kind(wp_client):
    """Missing 'kind' field returns 400."""
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "id": "abc123456789ab",
        "action": "delete",
    })
    assert resp.status == 400


async def test_cascade_apply_rejects_missing_action(wp_client):
    """Missing 'action' field returns 400."""
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard",
        "id": "abc123456789ab",
    })
    assert resp.status == 400


async def test_cascade_apply_rejects_missing_id(wp_client):
    """Missing 'id' field returns 400."""
    resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard",
        "action": "delete",
    })
    assert resp.status == 400


async def test_cascade_undo_reverses_apply(wp_client):
    """Apply then undo restores DB state."""
    # Create a wildcard.
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard",
        "name": "test_wc",
        "description": "",
        "category_id": None,
        "tags": [],
        "payload": {"options": []},
    })
    assert resp.status == 201
    wc = await resp.json()
    wc_id = wc["id"]

    # Apply cascade delete.
    apply_resp = await wp_client.post("/wp/api/cascade/apply", json={
        "kind": "wildcard",
        "id": wc_id,
        "action": "delete",
    })
    assert apply_resp.status == 200
    apply_body = await apply_resp.json()
    assert apply_body["ok"] is True
    undo_id = apply_body["undo_entry_id"]

    # Undo the cascade.
    undo_resp = await wp_client.post("/wp/api/cascade/undo", json={
        "undo_entry_id": undo_id,
    })
    assert undo_resp.status == 200
    undo_body = await undo_resp.json()
    assert undo_body["ok"] is True

    # Verify wildcard was restored.
    get_resp = await wp_client.get(f"/wp/api/modules/{wc_id}")
    assert get_resp.status == 200
    restored = await get_resp.json()
    assert restored["id"] == wc_id


async def test_cascade_undo_unknown_id_returns_404(wp_client):
    """Unknown undo_id maps to 404."""
    resp = await wp_client.post("/wp/api/cascade/undo", json={
        "undo_entry_id": "deadbeef00000000",
    })
    assert resp.status == 404


async def test_cascade_undo_rejects_missing_id(wp_client):
    """Missing undo_entry_id returns 400."""
    resp = await wp_client.post("/wp/api/cascade/undo", json={})
    assert resp.status == 400


async def test_cascade_undo_rejects_non_string_id(wp_client):
    """Non-string undo_entry_id returns 400."""
    resp = await wp_client.post("/wp/api/cascade/undo", json={
        "undo_entry_id": 12345,
    })
    assert resp.status == 400


async def test_cascade_undo_rejects_empty_string_id(wp_client):
    """Empty string undo_entry_id returns 400."""
    resp = await wp_client.post("/wp/api/cascade/undo", json={
        "undo_entry_id": "",
    })
    assert resp.status == 400
