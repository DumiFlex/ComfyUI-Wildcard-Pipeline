"""Tests for PUT /wp/api/modules/<id>/payload — save-to-library round-trip.

Uses the same async test pattern as the rest of tests/wp_api/:
  - `wp_client` fixture from conftest.py (shared aiohttp_client wrapping
    the full register_routes app).
  - pytestmark = pytest.mark.asyncio so every coroutine is auto-collected.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_wildcard(client, name: str = "colors") -> dict:
    """Create a minimal wildcard module and return the response body."""
    resp = await client.post("/wp/api/modules", json={
        "type": "wildcard",
        "name": name,
        "description": "",
        "category_id": None,
        "tags": [],
        "payload": {"options": []},
    })
    assert resp.status == 201
    return await resp.json()


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

async def test_put_payload_valid_returns_200_and_new_hash(wp_client):
    """Happy path: PUT a valid new payload → 200 + new_hash returned."""
    row = await _create_wildcard(wp_client)
    mid = row["id"]
    new_payload = {"options": [{"value": "red", "weight": 1}]}

    resp = await wp_client.put(f"/wp/api/modules/{mid}/payload", json={
        "payload": new_payload,
        "meta": {},
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["ok"] is True
    assert isinstance(body["new_hash"], str)
    assert len(body["new_hash"]) == 64  # SHA-256 hex digest


async def test_put_payload_nonexistent_id_returns_404(wp_client):
    """Non-existent module id → 404."""
    resp = await wp_client.put("/wp/api/modules/deadbeef/payload", json={
        "payload": {"options": []},
        "meta": {},
    })
    assert resp.status == 404


async def test_put_payload_invalid_payload_returns_400(wp_client):
    """Payload that fails handler validate_payload → 400.

    A combine module requires `template` to be a string. Passing an
    integer is rejected by CombineHandler.validate_payload."""
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "combine",
        "name": "joiner",
        "description": "",
        "category_id": None,
        "tags": [],
        "payload": {"template": "hello", "output_var": "out"},
    })
    assert resp.status == 201
    mid = (await resp.json())["id"]

    resp = await wp_client.put(f"/wp/api/modules/{mid}/payload", json={
        "payload": {"template": 42, "output_var": "out"},
        "meta": {},
    })
    assert resp.status == 400


async def test_put_payload_missing_body_returns_400(wp_client):
    """Missing / non-JSON body → 400."""
    row = await _create_wildcard(wp_client)
    mid = row["id"]

    resp = await wp_client.put(
        f"/wp/api/modules/{mid}/payload",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_put_payload_hash_determinism(wp_client):
    """Sending the same content twice yields identical new_hash values."""
    row = await _create_wildcard(wp_client)
    mid = row["id"]
    payload = {"options": [{"value": "blue", "weight": 1}]}
    body_json = {"payload": payload, "meta": {}}

    resp1 = await wp_client.put(f"/wp/api/modules/{mid}/payload", json=body_json)
    assert resp1.status == 200
    hash1 = (await resp1.json())["new_hash"]

    resp2 = await wp_client.put(f"/wp/api/modules/{mid}/payload", json=body_json)
    assert resp2.status == 200
    hash2 = (await resp2.json())["new_hash"]

    assert hash1 == hash2
