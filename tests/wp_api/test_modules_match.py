"""Tests for /wp/api/modules/match."""
import pytest

from engine.modules.snapshot import payload_hash

pytestmark = pytest.mark.asyncio


async def test_match_found(wp_client):
    payload = {"options": [{"id": "x", "value": "v", "weight": 1}]}
    create = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "colors", "description": "",
        "category_id": None, "tags": [], "payload": payload,
    })
    created = await create.json()
    resp = await wp_client.post("/wp/api/modules/match", json={
        "type": "wildcard", "name": "colors",
        "payload_hash": payload_hash(payload),
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["matched"] is True
    assert body["id"] == created["id"]
    assert body["version"] == 1


async def test_match_not_found_returns_matched_false(wp_client):
    resp = await wp_client.post("/wp/api/modules/match", json={
        "type": "wildcard", "name": "nope", "payload_hash": "0" * 64,
    })
    assert resp.status == 200
    body = await resp.json()
    assert body == {"matched": False}


async def test_match_name_present_but_hash_differs(wp_client):
    payload = {"options": []}
    await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "colors", "description": "",
        "category_id": None, "tags": [], "payload": payload,
    })
    resp = await wp_client.post("/wp/api/modules/match", json={
        "type": "wildcard", "name": "colors",
        "payload_hash": "0" * 64,
    })
    body = await resp.json()
    assert body == {"matched": False}


async def test_match_missing_fields_400(wp_client):
    resp = await wp_client.post("/wp/api/modules/match", json={"type": "wildcard"})
    assert resp.status == 400


async def test_match_invalid_json_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/modules/match",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400
