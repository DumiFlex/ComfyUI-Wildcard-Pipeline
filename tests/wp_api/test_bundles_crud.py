"""Tests for /wp/api/bundles CRUD + favorite endpoints."""
import pytest

pytestmark = pytest.mark.asyncio


# ── Listing + empty state ──────────────────────────────────────────────────


async def test_list_empty(wp_client):
    resp = await wp_client.get("/wp/api/bundles")
    assert resp.status == 200
    body = await resp.json()
    assert body == {"items": [], "total": 0}


async def test_list_after_create_returns_one(wp_client):
    await wp_client.post("/wp/api/bundles", json={
        "name": "subject_phrase",
        "children": [],
    })
    resp = await wp_client.get("/wp/api/bundles")
    assert resp.status == 200
    body = await resp.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "subject_phrase"


# ── Create ─────────────────────────────────────────────────────────────────


async def test_create_minimal_returns_201_with_8hex_id(wp_client):
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "lighting_setup",
    })
    assert resp.status == 201
    body = await resp.json()
    assert len(body["id"]) == 8
    assert all(c in "0123456789abcdef" for c in body["id"])
    assert body["name"] == "lighting_setup"
    assert body["color"] is None  # Default — UI falls back to #46566B
    assert body["children"] == []
    assert body["version"] == 1


async def test_create_with_color_and_children(wp_client):
    children = [
        {"id": "aabbcc11", "type": "wildcard", "payload": {"options": []}},
        {
            "id": "ddeeff22",
            "type": "combine",
            "payload": {"template": "$x", "output_var": "phrase"},
        },
    ]
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "subject_phrase",
        "color": "#FB7185",
        "children": children,
    })
    assert resp.status == 201
    body = await resp.json()
    assert body["color"] == "#FB7185"
    assert body["children"] == children
    # payload_hash is non-empty + stable (deterministic from children)
    assert body["payload_hash"] != ""


async def test_create_missing_name_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/bundles", json={
        "color": "#FB7185",
    })
    assert resp.status == 400


# ── Get ────────────────────────────────────────────────────────────────────


async def test_get_returns_full_row(wp_client):
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x", "children": [{"id": "aabbccdd", "type": "wildcard"}],
    })).json()
    resp = await wp_client.get(f"/wp/api/bundles/{created['id']}")
    assert resp.status == 200
    body = await resp.json()
    assert body == created


async def test_get_unknown_returns_404(wp_client):
    resp = await wp_client.get("/wp/api/bundles/aaaaaaaa")
    assert resp.status == 404


# ── Update ─────────────────────────────────────────────────────────────────


async def test_update_partial_persists(wp_client):
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x", "color": "#FB7185",
    })).json()
    resp = await wp_client.put(f"/wp/api/bundles/{created['id']}", json={
        "name": "renamed",
        "color": "#14B8A6",
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["name"] == "renamed"
    assert body["color"] == "#14B8A6"
    assert body["version"] == 2


async def test_update_children_changes_payload_hash(wp_client):
    """Children changes recompute payload_hash so inserted instances
    can detect the library has been updated."""
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x", "children": [],
    })).json()
    orig_hash = created["payload_hash"]
    resp = await wp_client.put(f"/wp/api/bundles/{created['id']}", json={
        "children": [{"id": "aabbccdd", "type": "wildcard"}],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["payload_hash"] != orig_hash


async def test_update_cosmetic_does_not_change_payload_hash(wp_client):
    """Pure-cosmetic field changes (rename, recolor, retag) leave
    payload_hash unchanged so inserted instances stay clean."""
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x", "children": [{"id": "aabbccdd", "type": "wildcard"}],
    })).json()
    orig_hash = created["payload_hash"]
    resp = await wp_client.put(f"/wp/api/bundles/{created['id']}", json={
        "name": "renamed", "color": "#14B8A6",
    })
    body = await resp.json()
    assert body["payload_hash"] == orig_hash


async def test_update_unknown_returns_404(wp_client):
    resp = await wp_client.put("/wp/api/bundles/aaaaaaaa", json={"name": "x"})
    assert resp.status == 404


# ── Delete ─────────────────────────────────────────────────────────────────


async def test_delete_returns_200_and_drops_row(wp_client):
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x",
    })).json()
    resp = await wp_client.delete(f"/wp/api/bundles/{created['id']}")
    assert resp.status == 200
    g = await wp_client.get(f"/wp/api/bundles/{created['id']}")
    assert g.status == 404


async def test_delete_unknown_returns_404(wp_client):
    resp = await wp_client.delete("/wp/api/bundles/aaaaaaaa")
    assert resp.status == 404


# ── Favorite ───────────────────────────────────────────────────────────────


async def test_favorite_toggle_flips_state(wp_client):
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x",
    })).json()
    assert created["is_favorite"] is False
    resp = await wp_client.post(f"/wp/api/bundles/{created['id']}/favorite")
    body = await resp.json()
    assert body["is_favorite"] is True
    resp = await wp_client.post(f"/wp/api/bundles/{created['id']}/favorite")
    body = await resp.json()
    assert body["is_favorite"] is False


async def test_favorite_explicit_set(wp_client):
    created = await (await wp_client.post("/wp/api/bundles", json={
        "name": "x",
    })).json()
    resp = await wp_client.post(
        f"/wp/api/bundles/{created['id']}/favorite",
        json={"is_favorite": True},
    )
    body = await resp.json()
    assert body["is_favorite"] is True


# ── Filters ────────────────────────────────────────────────────────────────


async def test_list_filter_by_query(wp_client):
    await wp_client.post("/wp/api/bundles", json={"name": "subject_phrase"})
    await wp_client.post("/wp/api/bundles", json={"name": "lighting_setup"})
    resp = await wp_client.get("/wp/api/bundles?q=subject")
    body = await resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "subject_phrase"


async def test_list_favorites_only(wp_client):
    a = await (await wp_client.post("/wp/api/bundles", json={"name": "a"})).json()
    await wp_client.post("/wp/api/bundles", json={"name": "b"})
    await wp_client.post(
        f"/wp/api/bundles/{a['id']}/favorite", json={"is_favorite": True},
    )
    resp = await wp_client.get("/wp/api/bundles?favorites=1")
    body = await resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "a"
