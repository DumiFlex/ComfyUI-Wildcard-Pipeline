"""Tests for /wp/api/import + /wp/api/export — library-only bundles."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_export_returns_modules_and_categories(wp_client):
    await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": "#a970ff", "icon": None,
    })
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "colors", "description": "",
        "category_id": "style", "tags": [], "payload": {"options": []},
    })
    resp = await wp_client.get("/wp/api/export")
    assert resp.status == 200
    bundle = await resp.json()
    assert bundle["version"] == 1
    assert "exported_at" in bundle
    assert len(bundle["modules"]) == 1
    assert len(bundle["categories"]) == 1


async def test_import_creates_modules_and_categories(wp_client):
    bundle = {
        "version": 1,
        "categories": [{
            "id": "style", "name": "Style", "color": None,
            "icon": None, "sort_order": 0,
        }],
        "modules": [{
            "id": "aaaa1234", "type": "wildcard", "name": "x",
            "description": "", "category_id": "style", "tags": [],
            "is_favorite": False, "payload": {"options": []},
            "version": 1, "created_at": "2026-04-26T00:00:00Z",
            "updated_at": "2026-04-26T00:00:00Z",
        }],
    }
    resp = await wp_client.post("/wp/api/import", json=bundle)
    assert resp.status == 200
    body = await resp.json()
    assert body == {
        "modules_imported": 1,
        "categories_imported": 1,
        "bundles_imported": 0,
        "skipped": [],
    }

    listing = await (await wp_client.get("/wp/api/modules")).json()
    assert listing["total"] == 1


async def test_import_skips_duplicate_module_id(wp_client):
    bundle = {
        "version": 1, "categories": [],
        "modules": [{
            "id": "aaaa1234", "type": "wildcard", "name": "x",
            "description": "", "category_id": None, "tags": [],
            "is_favorite": False, "payload": {"options": []},
            "version": 1, "created_at": "2026-04-26T00:00:00Z",
            "updated_at": "2026-04-26T00:00:00Z",
        }],
    }
    await wp_client.post("/wp/api/import", json=bundle)
    resp = await wp_client.post("/wp/api/import", json=bundle)
    body = await resp.json()
    assert body["modules_imported"] == 0
    assert "aaaa1234" in body["skipped"]


async def test_import_dedup_category_by_name_case_insensitive(wp_client):
    await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": None, "icon": None,
    })
    bundle = {
        "version": 1,
        "categories": [{
            "id": "style2", "name": "STYLE", "color": None,
            "icon": None, "sort_order": 0,
        }],
        "modules": [],
    }
    resp = await wp_client.post("/wp/api/import", json=bundle)
    body = await resp.json()
    assert body["categories_imported"] == 0


async def test_import_unsupported_version_400(wp_client):
    resp = await wp_client.post("/wp/api/import", json={
        "version": 99, "categories": [], "modules": [],
    })
    assert resp.status == 400


async def test_import_invalid_json_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/import",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_export_round_trip_via_import(wp_client):
    """Export a populated lib; re-importing into same DB skips duplicate ids/names."""
    await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": None, "icon": None,
    })
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "x", "description": "",
        "category_id": "style", "tags": [], "payload": {"options": []},
    })
    bundle_resp = await wp_client.get("/wp/api/export")
    bundle = await bundle_resp.json()
    # Re-importing into the SAME db should skip both rows (duplicate ids/names).
    re_import = await wp_client.post("/wp/api/import", json=bundle)
    body = await re_import.json()
    assert body["modules_imported"] == 0
    assert body["categories_imported"] == 0


async def test_import_skips_module_missing_required_field(wp_client):
    """Modules missing required fields are added to skipped, not raised as 500."""
    bundle = {
        "version": 1, "categories": [],
        "modules": [
            {"id": "aaaa1234", "type": "wildcard", "name": "good",
             "payload": {"options": []}},
            {"id": "bbbb1234"},  # missing type, name, payload
        ],
    }
    resp = await wp_client.post("/wp/api/import", json=bundle)
    assert resp.status == 200
    body = await resp.json()
    assert body["modules_imported"] == 1
    assert "bbbb1234" in body["skipped"]
