"""Tests for /wp/api/preview/resolve — RNG-faithful chain preview."""


async def test_preview_empty_chain_returns_empty(wp_client):
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": []})
    assert resp.status == 200
    body = await resp.json()
    assert body == {"resolved": {}}


async def test_preview_resolves_fixed_values_module(wp_client):
    """A fixed_values module's entries surface as resolved bindings."""
    chain = [[
        {
            "id": "abcdef00",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "stub"},
            "entries": [],
            "payload": {
                "values": [
                    {"id": "v0", "name": "style", "value": "noir"},
                    {"id": "v1", "name": "subject", "value": "fox"},
                ],
            },
        },
    ]]
    resp = await wp_client.post(
        "/wp/api/preview/resolve",
        json={"chain": chain, "seed": 42},
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["resolved"]["style"] == "noir"
    assert body["resolved"]["subject"] == "fox"


async def test_preview_seed_42_is_deterministic_across_calls(wp_client):
    """Same seed + same chain → identical resolved map every call."""
    chain = [[
        {
            "id": "abcdef00",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "color"},
            "entries": [],
            "payload": {
                "var_binding": "color",
                "options": [
                    {"id": "o1", "value": "red",   "weight": 1},
                    {"id": "o2", "value": "blue",  "weight": 1},
                    {"id": "o3", "value": "green", "weight": 1},
                ],
            },
        },
    ]]
    r1 = await wp_client.post("/wp/api/preview/resolve", json={"chain": chain, "seed": 42})
    r2 = await wp_client.post("/wp/api/preview/resolve", json={"chain": chain, "seed": 42})
    body1, body2 = await r1.json(), await r2.json()
    assert body1["resolved"] == body2["resolved"]
    assert body1["resolved"]["color"] in {"red", "blue", "green"}


async def test_preview_chains_upstream_to_downstream(wp_client):
    """Earlier chain step's bindings feed into later steps' ctx."""
    chain = [
        # Step 1: writes $base
        [{
            "id": "11111111",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "s1"},
            "entries": [],
            "payload": {"values": [{"id": "v0", "name": "base", "value": "wide"}]},
        }],
        # Step 2: writes $combo from $base via combine module
        [{
            "id": "22222222",
            "type": "combine",
            "enabled": True,
            "meta": {"name": "s2"},
            "entries": [],
            "payload": {"output_var": "combo", "template": "$base shot", "input_vars": ["base"]},
        }],
    ]
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": chain, "seed": 42})
    body = await resp.json()
    assert body["resolved"]["base"] == "wide"
    assert body["resolved"]["combo"] == "wide shot"


async def test_preview_invalid_body_400(wp_client):
    resp = await wp_client.post("/wp/api/preview/resolve", data="not json")
    assert resp.status == 400


async def test_preview_chain_must_be_list(wp_client):
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": "nope"})
    assert resp.status == 400


async def test_preview_multi_pick_returns_listvar_shape(wp_client):
    """SP2a: a multi-pick wildcard binds a ListVar. The endpoint must NOT 500
    on the dataclass — it serialises it as {"items": [...], "sep": ...} so the
    TS preview can join (bare $name) or index ($name.K) it like the engine."""
    chain = [[
        {
            "id": "abcdef00",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "color"},
            "entries": [],
            "instance": {"pick_min": 2, "pick_max": 2, "pick_separator": ", "},
            "payload": {
                "var_binding": "color",
                "options": [
                    {"id": "o1", "value": "red", "weight": 1},
                    {"id": "o2", "value": "blue", "weight": 1},
                    {"id": "o3", "value": "green", "weight": 1},
                ],
            },
        },
    ]]
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": chain, "seed": 42})
    assert resp.status == 200
    body = await resp.json()
    val = body["resolved"]["color"]
    assert isinstance(val, dict)
    assert val["sep"] == ", "
    assert len(val["items"]) == 2
    assert set(val["items"]).issubset({"red", "blue", "green"})


async def test_preview_internals_stripped(wp_client):
    """Engine ctx grows __wp_* internals; the response must not leak them."""
    chain = [[
        {
            "id": "abcdef00",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "stub"},
            "entries": [],
            "payload": {"values": [{"id": "v0", "name": "x", "value": "y"}]},
        },
    ]]
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": chain, "seed": 42})
    body = await resp.json()
    assert all(not k.startswith("__") for k in body["resolved"])
