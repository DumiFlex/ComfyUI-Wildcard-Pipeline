"""/wp/api/test/scenarios — saved Test Runner scenarios."""
from __future__ import annotations

BASE = "/wp/api/test/scenarios"


async def test_crud_round_trip(wp_client):
    resp = await wp_client.post(BASE, json={
        "name": "  Portrait  ",
        "stack": [{"module": "aaaa1111"}, {"bundle": "bbbb2222", "enabled": False}],
        "pins": {"camera": "35mm"},
        "seeds": {"from": 1000, "count": 200},
        "output_var": "scene_phrase",
    })
    assert resp.status == 201
    created = await resp.json()
    sid = created["id"]
    assert created["name"] == "Portrait"
    assert created["seeds"] == {"from": 1000, "count": 200}

    resp = await wp_client.put(f"{BASE}/{sid}", json={
        "is_pinned": True, "baseline": {"variables": {"mood": {"counts": {"x": 1}}}},
    })
    assert resp.status == 200
    updated = await resp.json()
    assert updated["is_pinned"] is True
    assert updated["baseline"]["variables"]["mood"]["counts"] == {"x": 1}
    assert updated["stack"] == created["stack"]

    assert (await (await wp_client.get(f"{BASE}/{sid}")).json()) == updated
    listing = await (await wp_client.get(BASE)).json()
    assert listing["total"] == 1

    assert (await wp_client.delete(f"{BASE}/{sid}")).status == 200
    assert (await wp_client.get(f"{BASE}/{sid}")).status == 404


async def test_list_filters_by_referenced_module(wp_client):
    await wp_client.post(BASE, json={"name": "a", "stack": [{"module": "aaaa1111"}]})
    await wp_client.post(BASE, json={"name": "b", "stack": [{"module": "cccc3333"}]})
    body = await (await wp_client.get(BASE, params={"module": "aaaa1111"})).json()
    assert [s["name"] for s in body["items"]] == ["a"]
    body = await (await wp_client.get(BASE, params={"q": "B"})).json()
    assert [s["name"] for s in body["items"]] == ["b"]


async def test_invalid_bodies_are_400(wp_client):
    for body in (
        {},
        {"name": ""},
        {"name": "x", "stack": {}},
        {"name": "x", "stack": [{"thing": 1}]},
        {"name": "x", "stack": [{"module": "a", "enabled": "yes"}]},
        {"name": "x", "pins": {"a": 1}},
        {"name": "x", "seeds": {"count": 0}},
        {"name": "x", "output_var": 3},
        {"name": "x", "baseline": []},
        {"name": "x", "is_pinned": "true"},
    ):
        resp = await wp_client.post(BASE, json=body)
        assert resp.status == 400, body
    created = await (await wp_client.post(BASE, json={"name": "ok"})).json()
    resp = await wp_client.put(f"{BASE}/{created['id']}", json={"name": "  "})
    assert resp.status == 400


async def test_unknown_ids_are_404(wp_client):
    assert (await wp_client.put(f"{BASE}/00000000", json={"name": "x"})).status == 404
    assert (await wp_client.delete(f"{BASE}/00000000")).status == 404
