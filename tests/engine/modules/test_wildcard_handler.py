"""Tests for WildcardHandler — weighted RNG + resolve_text-based expansion."""
import random

from engine.modules.wildcard_handler import WildcardHandler


def _payload(options):
    return {"options": options}


def _ctx(seed=0, catalog=None):
    """Return a minimal pipeline ctx dict for WildcardHandler."""
    return {
        "__wp_rng__": random.Random(seed),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog or {},
    }


def test_resolve_picks_one_option():
    # seed=0, first random() call → 0.0 (or close) → picks first option
    # Use seed that deterministically picks "alpha" (weight=1 each, total=2)
    # With seed 0, random() → 0.844... * 2 = 1.68 → beta
    # With seed 1, random() → 0.134... * 2 = 0.268 → alpha
    ctx = _ctx(seed=1)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_resolve_respects_weights_heavy_b():
    # weight=1 for alpha, weight=99 for beta, total=100
    # seed=0: random()=0.844... * 100 = 84.4 → cumulative after alpha=1, after beta=100 → beta
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 99},
    ])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "beta"}


def test_resolve_empty_options_returns_empty_string():
    out = WildcardHandler.resolve(
        _payload([]), instance={"variable_binding": "$x"}, ctx=_ctx(),
    )
    assert out == {"$x": ""}


def test_resolve_filters_by_enabled_options():
    # Only "b" is enabled; with seed=0 only option is beta → picks beta
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "enabled_options": ["b"]},
        ctx=ctx,
    )
    assert out == {"$x": "beta"}


def test_resolve_at_ref_expands_via_catalog():
    """@{8hexuuid} in option value resolves via the catalog (resolve_text path).

    The tokenizer requires exactly 8 lowercase hex chars inside @{...}.
    """
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": {
            "aabbccdd": {
                "type": "wildcard",
                "var_binding": "x",
                "options": [{"value": "expanded", "weight": 1}],
            },
        },
    }
    payload = _payload([{"id": "a", "value": "@{aabbccdd}", "weight": 1}])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "expanded"}


def test_resolve_at_ref_unknown_ref_emits_empty():
    """@{uuid} with no catalog entry → empty string (warning pushed, no crash)."""
    ctx = _ctx(seed=0)
    payload = _payload([{"id": "a", "value": "before @{00000000} after", "weight": 1}])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$y"}, ctx=ctx,
    )
    assert out == {"$y": "before  after"}
    # A warning should have been pushed for the unknown ref
    assert any(w.get("type") == "unknown_ref" for w in ctx["__wp_warnings__"])


def test_resolve_at_ref_max_depth_raises_or_warns():
    """Cyclic @{ref} chain hits recursion limit (strict=False → warning + empty)."""
    catalog = {
        "aaaaaaaa": {
            "type": "wildcard",
            "var_binding": "x",
            "options": [{"value": "@{aaaaaaaa}", "weight": 1}],
        },
    }
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog,
    }
    payload = _payload([{"id": "opt", "value": "@{aaaaaaaa}", "weight": 1}])
    # Non-strict mode: should not raise, should push a warning
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": ""}
    # cycle_detected or recursion_limit warning expected
    assert any(
        w.get("type") in {"cycle_detected", "recursion_limit"}
        for w in ctx["__wp_warnings__"]
    )


def test_resolve_returns_empty_when_no_binding():
    payload = _payload([{"id": "a", "value": "x", "weight": 1}])
    out = WildcardHandler.resolve(payload, instance={}, ctx=_ctx())
    assert out == {}


def test_resolve_zero_weight_falls_back_to_first():
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 0},
        {"id": "b", "value": "beta", "weight": 0},
    ])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "alpha"}  # all zero weights → first option


def test_resolve_negative_weight_clamped_to_zero():
    # alpha has effective weight 0 (negative clamped), beta has weight=1
    # With any seed, beta should always be chosen
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": -5},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "beta"}


def test_resolve_default_weight_is_1():
    """Options without 'weight' key default to weight=1."""
    # seed=1: random()=0.134... * 2 = 0.268 → alpha (cumulative after alpha=1 > 0.268)
    ctx = _ctx(seed=1)
    payload = _payload([
        {"id": "a", "value": "alpha"},  # no weight
        {"id": "b", "value": "beta"},   # no weight
    ])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_handler_type_id_is_wildcard():
    assert WildcardHandler.type_id == "wildcard"


def test_resolve_via_dispatcher_after_import():
    """Importing engine.modules auto-registers WildcardHandler in the dispatcher."""
    from engine.modules import resolve_module
    ctx = _ctx(seed=0)
    snap = {
        "type": "wildcard",
        "payload": _payload([{"id": "a", "value": "x", "weight": 1}]),
        "instance": {"variable_binding": "$z"},
    }
    out = resolve_module(snap, ctx=ctx)
    assert out == {"$z": "x"}


def test_resolve_inline_pick_in_option():
    """{a|b|c} in option value is resolved by resolve_text."""
    ctx = _ctx(seed=42)
    payload = _payload([{"value": "{red|blue|green}", "weight": 1}])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "color"}, ctx=ctx,
    )
    assert out["color"] in {"red", "blue", "green"}


def test_resolve_var_substitution_in_option():
    """$var references in option values are expanded from ctx."""
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": {},
        "style": "photorealistic",
    }
    payload = _payload([{"value": "$style photo", "weight": 1}])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "result"}, ctx=ctx,
    )
    assert out == {"result": "photorealistic photo"}


def test_resolve_instance_binding_overrides_payload():
    """instance.variable_binding takes priority over payload.var_binding."""
    ctx = _ctx(seed=0)
    payload = {"var_binding": "payload_key", "options": [{"value": "val", "weight": 1}]}
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "instance_key"}, ctx=ctx,
    )
    assert "instance_key" in out
    assert "payload_key" not in out


def test_resolve_uses_payload_var_binding_when_no_instance_binding():
    """payload.var_binding used when instance has no variable_binding."""
    ctx = _ctx(seed=0)
    payload = {"var_binding": "payload_key", "options": [{"value": "val", "weight": 1}]}
    out = WildcardHandler.resolve(
        payload, instance={}, ctx=ctx,
    )
    assert "payload_key" in out
