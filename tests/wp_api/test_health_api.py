"""/wp/api/health — scan, ignore list and the variety check."""
from __future__ import annotations

from engine.db.connection import get_connection
from engine.db.repositories import BundleRepository, ModuleRepository


def _seed():
    conn = get_connection()
    try:
        repo = ModuleRepository(conn)
        weather = repo.create(
            type="wildcard", name="Weather", description="", category_id=None, tags=[],
            payload={"var_binding": "weather", "options": [
                {"id": "o_rain", "value": "rain", "weight": 1},
                {"id": "o_sun", "value": "sun", "weight": 1},
                {"id": "o_fog", "value": "fog", "weight": 0},
            ]},
        )
        lonely = repo.create(
            type="wildcard", name="Lonely", description="", category_id=None, tags=[],
            payload={"var_binding": "lonely", "options": [
                {"id": "o_x", "value": "@{deadbeef#Gone} x", "weight": 1},
            ]},
        )
        bundle = BundleRepository(conn).create(
            name="Sky",
            children=[{"id": weather["id"], "type": "wildcard", "enabled": True,
                       "meta": {"name": "Weather"}, "payload": weather["payload"], "instance": {}}],
        )
        return weather, lonely, bundle
    finally:
        conn.close()


def _checks(body, check):
    return [f for f in body["findings"] if f["check"] == check]


async def test_scan_without_canvas(wp_client):
    weather, lonely, _ = _seed()
    resp = await wp_client.post("/wp/api/health/scan", json={})
    assert resp.status == 200
    body = await resp.json()
    assert body["canvas"] is False
    assert [f["item"]["id"] for f in _checks(body, "missing_ref")] == [lonely["id"]]
    assert [f["item"]["id"] for f in _checks(body, "zero_weight")] == [weather["id"]]
    unused = _checks(body, "unused")
    assert [f["item"]["id"] for f in unused] == [lonely["id"]]
    assert "open one to check" in unused[0]["detail"]
    assert body["counts"]["problem"] == 1
    assert {c["id"] for c in body["checks"]} >= {"missing_ref", "unused"}


async def test_scan_with_canvas_ids(wp_client):
    _, lonely, _ = _seed()
    resp = await wp_client.post("/wp/api/health/scan", json={
        "canvas": {"ids": [lonely["id"]], "vars": [], "reads": []},
    })
    body = await resp.json()
    assert body["canvas"] is True
    assert _checks(body, "unused") == []


async def test_scan_rejects_bad_canvas(wp_client):
    resp = await wp_client.post("/wp/api/health/scan", json={"canvas": "yes"})
    assert resp.status == 400


async def test_ignore_round_trip(wp_client):
    _, lonely, _ = _seed()
    key = f"unused:module:{lonely['id']}"
    resp = await wp_client.put("/wp/api/health/ignored", json={"add": [key, key]})
    assert resp.status == 200
    assert (await resp.json())["ignored"] == [key]
    body = await (await wp_client.post("/wp/api/health/scan", json={})).json()
    assert body["ignored"] == [key]
    assert body["counts"]["tidy"] == len(_checks(body, "unused")) - 1 + sum(
        1 for f in body["findings"] if f["severity"] == "tidy" and f["check"] != "unused")
    resp = await wp_client.put("/wp/api/health/ignored", json={"remove": [key]})
    assert (await resp.json())["ignored"] == []


async def test_ignore_validates(wp_client):
    assert (await wp_client.put("/wp/api/health/ignored", json={"add": "x"})).status == 400
    assert (await wp_client.put("/wp/api/health/ignored", json={"add": ["k" * 400]})).status == 400


async def test_variety(wp_client):
    _, _, bundle = _seed()
    resp = await wp_client.post("/wp/api/health/variety",
                                json={"bundle_id": bundle["id"], "seeds": 60})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["runs"] == 60
    assert body["distinct"] == 2
    assert body["ratio"] == round(2 / 60, 3)
    assert body["stuck"] == []
    assert body["never_picked"] == []


async def test_variety_errors(wp_client):
    assert (await wp_client.post("/wp/api/health/variety", json={})).status == 400
    assert (await wp_client.post("/wp/api/health/variety",
                                 json={"bundle_id": "nope0000", "seeds": 0})).status == 400
    assert (await wp_client.post("/wp/api/health/variety",
                                 json={"bundle_id": "nope0000"})).status == 404


def test_summarize_variety_stuck_and_never_picked():
    from wp_api.health import summarize_variety
    mods = [{"id": "w1", "_uid": "s0.0", "type": "wildcard", "meta": {"name": "Weather"},
             "payload": {"var_binding": "weather", "options": [
                 {"id": "a", "value": "rain"}, {"id": "b", "value": "sun"},
                 {"id": "c", "value": ""}]}}]
    result = {"runs": 3, "failed": 0,
              "variables": {"weather": {"distinct": 1, "counts": {"rain": 3}}},
              "picks": {"s0.0": {"a": 3}},
              "samples": [{"vars": {"weather": "rain"}}] * 3,
              "warnings": [{"type": "t", "message": "m", "count": 2}]}
    out = summarize_variety(mods, result)
    assert out["distinct"] == 1 and out["ratio"] == 0.333
    assert out["stuck"] == [{"var": "weather", "name": "Weather", "value": "rain"}]
    assert out["never_picked"] == [
        {"id": "w1", "name": "Weather", "options": ["sun"], "count": 1, "total": 2}]
    assert out["warnings"] == [{"type": "t", "message": "m", "count": 2}]
