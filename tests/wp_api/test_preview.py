"""Tests for /wp/api/preview/resolve — RNG-faithful chain preview."""


async def test_preview_empty_chain_returns_empty(wp_client):
    resp = await wp_client.post("/wp/api/preview/resolve", json={"chain": []})
    assert resp.status == 200
    body = await resp.json()
    assert body == {"resolved": {}, "axes": {}, "negatives": {}}


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


async def test_preview_returns_the_rolled_accepts_axes(wp_client):
    """`$var.AXIS` in the assembler preview has to read the tag the preview
    run actually rolled, so the axes table rides beside the values. An option
    with no tag on the axis rolls nothing, which is what renders empty."""
    chain = [[
        {
            "id": "abcdef01",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "outfit"},
            "entries": [],
            "payload": {
                "var_binding": "outfit",
                "sub_categories": ["sandals", "boots"],
                "tag_groups": {"SHOES": ["sandals", "boots"]},
                "tag_group_kinds": {"SHOES": "accepts"},
                "options": [
                    {"id": "o1", "value": "jeans", "weight": 1,
                     "sub_categories": ["boots"]},
                ],
            },
        },
        {
            "id": "abcdef02",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "hat"},
            "entries": [],
            "payload": {
                "var_binding": "hat",
                "sub_categories": ["sandals"],
                "tag_groups": {"SHOES": ["sandals"]},
                "tag_group_kinds": {"SHOES": "accepts"},
                "options": [{"id": "o1", "value": "cap", "weight": 1}],
            },
        },
    ]]
    resp = await wp_client.post(
        "/wp/api/preview/resolve", json={"chain": chain, "seed": 42},
    )
    body = await resp.json()
    assert body["resolved"]["outfit"] == "jeans"
    assert body["axes"]["outfit"] == {"SHOES": "boots"}
    assert body["axes"]["hat"] == {}


async def test_preview_returns_each_variables_negatives(wp_client):
    """Send-to-negative: the Assembler builds its negative preview locally
    from the variables its template uses, so the table rides along."""
    chain = [[{
        "id": "abcdef03",
        "type": "wildcard",
        "enabled": True,
        "meta": {"name": "hair"},
        "entries": [],
        "payload": {
            "var_binding": "hair",
            "options": [{"id": "o1", "value": "red hair", "weight": 1,
                         "negative": "blonde"}],
        },
    }]]
    resp = await wp_client.post(
        "/wp/api/preview/resolve", json={"chain": chain, "seed": 42},
    )
    body = await resp.json()
    assert body["negatives"]["hair"] == [
        {"text": "blonde", "pick": None, "source": "hair"},
    ]


def _many_colors_chain(binding: str = "color") -> list:
    return [[{
        "id": "abcdef01",
        "type": "wildcard",
        "enabled": True,
        "meta": {"name": binding},
        "entries": [],
        "payload": {
            "var_binding": binding,
            "options": [{"id": f"o{i}", "value": f"c{i}", "weight": 1} for i in range(40)],
        },
    }]]


async def _resolve(wp_client, body):
    resp = await wp_client.post("/wp/api/preview/resolve", json=body)
    assert resp.status == 200
    return (await resp.json())["resolved"]


async def test_preview_step_seeds_follow_each_context(wp_client):
    """`seeds[i]` rolls step i on its own seed: the same as `seed` alone with
    that value, and different seeds give different picks."""
    chain = _many_colors_chain()
    picks = set()
    for s in range(1, 9):
        via_list = await _resolve(wp_client, {"chain": chain, "seed": 42, "seeds": [s]})
        via_seed = await _resolve(wp_client, {"chain": chain, "seed": s})
        assert via_list == via_seed
        picks.add(via_list["color"])
    assert len(picks) > 1


async def test_preview_null_or_missing_step_seed_uses_seed(wp_client):
    chain = _many_colors_chain()
    base = await _resolve(wp_client, {"chain": chain, "seed": 7})
    assert await _resolve(wp_client, {"chain": chain, "seed": 7, "seeds": [None]}) == base
    assert await _resolve(wp_client, {"chain": chain, "seed": 7, "seeds": []}) == base
    assert await _resolve(wp_client, {"chain": chain, "seed": 7, "seeds": ["x", True]}) == base
