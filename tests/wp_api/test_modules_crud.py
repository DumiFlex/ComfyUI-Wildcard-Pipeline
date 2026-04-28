"""Tests for /wp/api/modules CRUD endpoints."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_list_empty(wp_client):
    resp = await wp_client.get("/wp/api/modules")
    assert resp.status == 200
    body = await resp.json()
    assert body == {"items": [], "total": 0}


async def test_create_returns_201_and_id(wp_client):
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "colors", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    assert resp.status == 201
    body = await resp.json()
    assert body["id"].startswith("wc_colors_")
    assert body["version"] == 1
    assert body["payload"] == {"options": []}


async def test_create_missing_type_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/modules", json={
        "name": "x", "payload": {"values": []},
    })
    assert resp.status == 400


async def test_create_invalid_json_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/modules",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_get_by_id(wp_client):
    create = await wp_client.post("/wp/api/modules", json={
        "type": "fixed_values", "name": "lens", "description": "",
        "category_id": None, "tags": [], "payload": {"values": []},
    })
    mid = (await create.json())["id"]
    resp = await wp_client.get(f"/wp/api/modules/{mid}")
    assert resp.status == 200
    body = await resp.json()
    assert body["id"] == mid
    assert body["type"] == "fixed_values"


async def test_get_missing_404(wp_client):
    resp = await wp_client.get("/wp/api/modules/ghost")
    assert resp.status == 404


async def test_put_updates_only_provided_fields(wp_client):
    create = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "x", "description": "hello",
        "category_id": None, "tags": ["a"], "payload": {"options": []},
    })
    mid = (await create.json())["id"]
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={"name": "y"})
    assert resp.status == 200
    body = await resp.json()
    assert body["name"] == "y"
    assert body["description"] == "hello"  # unchanged
    assert body["tags"] == ["a"]            # unchanged
    assert body["version"] == 2


async def test_put_missing_404(wp_client):
    resp = await wp_client.put("/wp/api/modules/ghost", json={"name": "x"})
    assert resp.status == 404


async def test_delete_returns_204(wp_client):
    create = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "x", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    mid = (await create.json())["id"]
    resp = await wp_client.delete(f"/wp/api/modules/{mid}")
    assert resp.status == 204
    follow = await wp_client.get(f"/wp/api/modules/{mid}")
    assert follow.status == 404


async def test_delete_missing_404(wp_client):
    resp = await wp_client.delete("/wp/api/modules/ghost")
    assert resp.status == 404


async def test_list_filter_by_type(wp_client):
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "a", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    await wp_client.post("/wp/api/modules", json={
        "type": "fixed_values", "name": "b", "description": "",
        "category_id": None, "tags": [], "payload": {"values": []},
    })
    resp = await wp_client.get("/wp/api/modules?type=wildcard")
    body = await resp.json()
    assert body["total"] == 1
    assert body["items"][0]["type"] == "wildcard"


async def test_list_search_filter(wp_client):
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "ColorPalette", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "lighting", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    resp = await wp_client.get("/wp/api/modules?q=color")
    body = await resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "ColorPalette"


async def test_list_total_ignores_limit(wp_client):
    """Regression: Dashboard count cards used to read 1 for every kind
    because list_modules returned `total = len(items)` AFTER the LIMIT
    was applied. `total` must reflect the unpaginated row count so the
    SPA can poll cheaply with limit=1 yet still display the real total."""
    for n in ("a", "b", "c"):
        await wp_client.post("/wp/api/modules", json={
            "type": "wildcard", "name": n, "description": "",
            "category_id": None, "tags": [], "payload": {"options": []},
        })
    resp = await wp_client.get("/wp/api/modules?type=wildcard&limit=1")
    body = await resp.json()
    assert len(body["items"]) == 1   # paginated
    assert body["total"] == 3        # but total reflects ALL rows


async def test_list_invalid_limit_400(wp_client):
    resp = await wp_client.get("/wp/api/modules?limit=abc")
    assert resp.status == 400


async def test_list_negative_limit_400(wp_client):
    resp = await wp_client.get("/wp/api/modules?limit=-1")
    assert resp.status == 400


async def test_list_negative_offset_400(wp_client):
    resp = await wp_client.get("/wp/api/modules?offset=-1")
    assert resp.status == 400
