"""Tests for /wp/api/categories CRUD."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_list_empty(wp_client):
    resp = await wp_client.get("/wp/api/categories")
    body = await resp.json()
    assert body == {"items": []}


async def test_create_and_list(wp_client):
    resp = await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": "#a970ff", "icon": "pi pi-palette",
    })
    assert resp.status == 201
    body = await resp.json()
    assert body["id"] == "style"

    listing = await wp_client.get("/wp/api/categories")
    items = (await listing.json())["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Style"


async def test_create_missing_name_400(wp_client):
    resp = await wp_client.post("/wp/api/categories", json={"color": "#fff"})
    assert resp.status == 400


async def test_create_invalid_json_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/categories",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_create_duplicate_name_409(wp_client):
    await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": None, "icon": None,
    })
    dup = await wp_client.post("/wp/api/categories", json={
        "name": "STYLE", "color": None, "icon": None,
    })
    assert dup.status == 409


async def test_update_changes_fields(wp_client):
    await wp_client.post("/wp/api/categories", json={
        "name": "Style", "color": None, "icon": None,
    })
    resp = await wp_client.put("/wp/api/categories/style", json={
        "color": "#ff0000", "sort_order": 5,
    })
    body = await resp.json()
    assert body["color"] == "#ff0000"
    assert body["sort_order"] == 5


async def test_update_missing_404(wp_client):
    resp = await wp_client.put("/wp/api/categories/ghost", json={"color": "#fff"})
    assert resp.status == 404


async def test_delete(wp_client):
    await wp_client.post("/wp/api/categories", json={
        "name": "Tmp", "color": None, "icon": None,
    })
    resp = await wp_client.delete("/wp/api/categories/tmp")
    assert resp.status == 204


async def test_delete_missing_404(wp_client):
    resp = await wp_client.delete("/wp/api/categories/ghost")
    assert resp.status == 404
