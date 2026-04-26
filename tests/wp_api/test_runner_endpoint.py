"""Tests for /wp/api/test — runs the engine dispatcher against an ad-hoc snapshot."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_run_wildcard(wp_client):
    resp = await wp_client.post("/wp/api/test", json={
        "type": "wildcard",
        "payload": {"options": [{"id": "a", "value": "alpha", "weight": 1}]},
        "instance": {"variable_binding": "$x"},
        "samples": 5,
    })
    assert resp.status == 200
    body = await resp.json()
    assert len(body["results"]) == 5
    assert all(r == {"$x": "alpha"} for r in body["results"])
    assert body["histogram"] == {"alpha": 5}


async def test_run_fixed_values(wp_client):
    resp = await wp_client.post("/wp/api/test", json={
        "type": "fixed_values",
        "payload": {"values": [{"id": "v1", "name": "$lens", "value": "85mm"}]},
        "instance": {},
        "samples": 1,
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["results"][0] == {"$lens": "85mm"}
    assert body["histogram"] == {"85mm": 1}


async def test_run_unknown_type_400(wp_client):
    resp = await wp_client.post("/wp/api/test", json={
        "type": "ghost", "payload": {}, "instance": {}, "samples": 1,
    })
    assert resp.status == 400


async def test_run_missing_fields_400(wp_client):
    resp = await wp_client.post("/wp/api/test", json={"type": "wildcard"})
    assert resp.status == 400


async def test_run_invalid_json_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/test",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_run_samples_out_of_range(wp_client):
    base = {
        "type": "wildcard",
        "payload": {"options": [{"id": "a", "value": "alpha", "weight": 1}]},
        "instance": {"variable_binding": "$x"},
    }
    low = await wp_client.post("/wp/api/test", json={**base, "samples": 0})
    assert low.status == 400
    high = await wp_client.post("/wp/api/test", json={**base, "samples": 99999})
    assert high.status == 400
