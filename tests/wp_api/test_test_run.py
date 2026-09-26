"""POST /wp/api/test/run — scenario runs against the live library."""
from __future__ import annotations

from engine.db.connection import get_connection
from engine.db.repositories import BundleRepository, ModuleRepository


def _seed_library():
    """color ← outfit (nested @ref), plus a bundle holding both."""
    conn = get_connection()
    try:
        repo = ModuleRepository(conn)
        color = repo.create(
            type="wildcard", name="color", description="", category_id=None, tags=[],
            payload={"var_binding": "color", "options": [
                {"id": "o_red", "value": "red", "weight": 1},
                {"id": "o_blue", "value": "blue", "weight": 1},
            ]},
        )
        outfit = repo.create(
            type="wildcard", name="outfit", description="", category_id=None, tags=[],
            payload={"var_binding": "outfit", "options": [
                {"id": "o_dress", "value": f"@{{{color['id']}}} dress", "weight": 1},
            ]},
        )
        phrase = repo.create(
            type="combine", name="phrase", description="", category_id=None, tags=[],
            payload={"template": "$who wearing $outfit", "output_var": "phrase"},
        )
        bundle = BundleRepository(conn).create(
            name="look",
            children=[
                {"id": outfit["id"], "type": "wildcard", "enabled": True,
                 "meta": {"name": "outfit"}, "payload": outfit["payload"], "instance": {}},
                {"id": phrase["id"], "type": "combine", "enabled": True,
                 "meta": {"name": "phrase"}, "payload": phrase["payload"], "instance": {}},
            ],
        )
        return color, outfit, phrase, bundle
    finally:
        conn.close()


async def test_nested_refs_resolve_from_the_library(wp_client):
    _, outfit, _, _ = _seed_library()
    resp = await wp_client.post("/wp/api/test/run", json={
        "stack": [{"module": outfit["id"]}],
        "seeds": {"from": 0, "count": 40},
    })
    assert resp.status == 200
    body = await resp.json()
    counts = body["variables"]["outfit"]["counts"]
    assert set(counts) == {"red dress", "blue dress"}
    assert sum(counts.values()) == 40
    assert body["stack"] == [{
        "index": 0, "kind": "module", "id": outfit["id"], "name": "outfit",
        "type": "wildcard", "uids": ["s0"],
    }]


async def test_same_seeds_give_the_same_result(wp_client):
    """Unlike the old /wp/api/test, every sample runs on its own seed and a
    seed always reproduces."""
    color, *_ = _seed_library()
    req = {"stack": [{"module": color["id"]}], "seeds": {"from": 100, "count": 50}}
    a = await (await wp_client.post("/wp/api/test/run", json=req)).json()
    b = await (await wp_client.post("/wp/api/test/run", json=req)).json()
    assert a["variables"] == b["variables"]
    assert len(a["variables"]["color"]["counts"]) == 2


async def test_bundle_expands_with_origin_and_pins(wp_client):
    _, _, _, bundle = _seed_library()
    resp = await wp_client.post("/wp/api/test/run", json={
        "stack": [{"bundle": bundle["id"]}],
        "pins": {"$who": "a fox"},
        "seeds": {"list": [1, 2, 3]},
    })
    body = await resp.json()
    assert body["pins"] == {"who": "a fox"}
    assert body["stack"][0]["uids"] == ["s0.0", "s0.1"]
    phrases = body["variables"]["phrase"]["counts"]
    assert all(p.startswith("a fox wearing ") and p.endswith(" dress") for p in phrases)
    trace = body["samples"][0]["trace"]
    assert [r["_uid"] for r in trace] == ["s0.0", "s0.1"]
    assert [r["name"] for r in trace] == ["outfit", "phrase"]


async def test_disabled_items_are_skipped(wp_client):
    color, outfit, *_ = _seed_library()
    resp = await wp_client.post("/wp/api/test/run", json={
        "stack": [{"module": color["id"], "enabled": False}, {"module": outfit["id"]}],
        "seeds": {"from": 0, "count": 5},
    })
    body = await resp.json()
    assert "color" not in body["variables"]
    assert body["samples"][0]["trace"][0]["status"] == "skipped_disabled"


async def test_missing_modules_are_reported_not_fatal(wp_client):
    color, *_ = _seed_library()
    resp = await wp_client.post("/wp/api/test/run", json={
        "stack": [{"module": "deadbeef"}, {"bundle": "0badf00d"}, {"module": color["id"]}],
        "seeds": {"from": 0, "count": 3},
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["missing"] == [
        {"kind": "module", "id": "deadbeef"},
        {"kind": "bundle", "id": "0badf00d"},
    ]
    assert body["stack"][0]["uids"] == ["s2"]
    assert body["runs"] == 3


async def test_bad_requests_are_400(wp_client):
    color, *_ = _seed_library()
    good = {"module": color["id"]}
    for body in (
        [],
        {"stack": []},
        {"stack": [{"nope": 1}]},
        {"stack": [good], "seeds": {"count": 0}},
        {"stack": [good], "pins": ["x"]},
        {"stack": [good], "sample_limit": -1},
        {"stack": [good], "value_limit": "many"},
    ):
        resp = await wp_client.post("/wp/api/test/run", json=body)
        assert resp.status == 400, body
        assert "error" in await resp.json()


async def test_default_seeds_are_random(wp_client):
    color, *_ = _seed_library()
    resp = await wp_client.post("/wp/api/test/run", json={"stack": [{"module": color["id"]}]})
    body = await resp.json()
    assert body["runs"] == 100
    assert len({s["seed"] for s in body["samples"]}) == 100
