"""Tests for WildcardHandler — weighted RNG + resolve_text-based expansion."""
import random

from engine.modules.wildcard_handler import WildcardHandler


def _payload(options):
    return {"options": options}


def _ctx(seed=0, catalog=None):
    """Return a minimal pipeline ctx dict for WildcardHandler.

    `__wp_node_seed__` is set so the handler's chain-seed branch
    reads the same value `__wp_rng__` was constructed from. The
    real `PipelineEngine.run` populates both — handler tests
    bypass the engine, so we mirror it here.
    """
    return {
        "__wp_rng__": random.Random(seed),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog or {},
        "__wp_node_seed__": int(seed),
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


def test_resolve_var_in_option_renders_literal_warns():
    """$var references in wildcard option values do NOT read upstream
    (wildcard surface is a binding PRODUCER, not a consumer). Lenient
    mode renders the literal `$name` text + emits a warning.

    This contract was tightened during the combine v2 + syntax parity
    cycle so wildcard / combine / fixed_values surfaces have explicit
    authority over which token kinds resolve. See
    docs/superpowers/specs/2026-05-08-combine-and-fixed-values-syntax-parity-design.md
    "Surface support matrix".
    """
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
    assert out == {"result": "$style photo"}
    assert any(w.get("type") == "var_out_of_surface" for w in ctx["__wp_warnings__"])


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


def test_resolve_option_weights_override_replaces_library_weight():
    """instance.option_weights replaces (not multiplies) the library weight.

    Library weights: alpha=1, beta=1 (50/50). Override: alpha=99, beta=1
    → alpha picked overwhelmingly. Pin one seed to confirm.
    """
    # seed=0 → random()=0.844; with overridden weights (99+1=100 total),
    # 0.844*100=84.4 → alpha (cumulative reaches 99 before beta).
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "option_weights": {"a": 99.0, "b": 1.0},
        },
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_resolve_option_weights_override_ignores_unknown_ids():
    """Override ids that don't match any option are silently ignored."""
    ctx = _ctx(seed=1)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "option_weights": {"nonexistent": 99.0},
        },
        ctx=ctx,
    )
    # Falls through to library 50/50; seed=1 → alpha.
    assert out == {"$x": "alpha"}


def test_resolve_option_weights_override_skips_non_numeric_value():
    """Non-numeric weight overrides leave the library weight intact."""
    ctx = _ctx(seed=1)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "option_weights": {"a": "not-a-number"},
        },
        ctx=ctx,
    )
    # Override skipped; library 50/50; seed=1 → alpha.
    assert out == {"$x": "alpha"}


def test_resolve_category_filter_keeps_only_matching_options():
    """instance.category_filter narrows the pool by `sub_categories`."""
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1, "sub_categories": ["warm"]},
        {"id": "b", "value": "beta",  "weight": 1, "sub_categories": ["cool"]},
        {"id": "c", "value": "gamma", "weight": 1, "sub_categories": ["warm"]},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "category_filter": "warm"},
        ctx=ctx,
    )
    # Pool is now {alpha, gamma} — both weight=1. With per-module
    # rng (sha256 of chain_seed:binding) chain_seed=0 picks alpha.
    # The invariant is "result is in the warm subset", not the exact
    # name; the explicit assertion pins one seed→pick mapping so a
    # rng-derivation regression would surface here.
    assert out == {"$x": "alpha"}
    assert out["$x"] in {"alpha", "gamma"}  # invariant — never picks beta (cool)


def test_resolve_category_filter_excludes_options_without_sub_category():
    """Options missing sub_category get dropped by an explicit filter."""
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1, "sub_categories": ["warm"]},
        {"id": "b", "value": "beta",  "weight": 1},  # no sub_category
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "category_filter": "warm"},
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_resolve_category_filter_empty_list_falls_through():
    """Empty list = no filter, same as None."""
    ctx = _ctx(seed=1)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1, "sub_categories": ["warm"]},
        {"id": "b", "value": "beta",  "weight": 1, "sub_categories": ["cool"]},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "category_filter": ""},
        ctx=ctx,
    )
    # Empty filter = no filtering; seed=1 → alpha at 50/50.
    assert out == {"$x": "alpha"}


def test_resolve_category_filter_combines_with_enabled_options():
    """Both filters apply — category narrows first, then enable list."""
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1, "sub_categories": ["warm"]},
        {"id": "b", "value": "beta",  "weight": 1, "sub_categories": ["warm"]},
        {"id": "c", "value": "gamma", "weight": 1, "sub_categories": ["cool"]},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "category_filter": "warm",
            "enabled_options": ["b", "c"],  # c excluded by category
        },
        ctx=ctx,
    )
    # Pool after both: {b}. Always picks beta.
    assert out == {"$x": "beta"}


def test_resolve_locked_seed_is_independent_of_chain_seed():
    """Locking a wildcard makes its pick reproducible across runs even
    when the chain's `__wp_node_seed__` rotates."""
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta",  "weight": 1},
        {"id": "c", "value": "gamma", "weight": 1},
    ])
    # Two different chain seeds → same locked_seed → same pick.
    out_seed_0 = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": 99},
        ctx=_ctx(seed=0),
    )
    out_seed_1 = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": 99},
        ctx=_ctx(seed=1),
    )
    out_seed_42 = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": 99},
        ctx=_ctx(seed=42),
    )
    assert out_seed_0 == out_seed_1 == out_seed_42


def test_resolve_locked_seed_different_per_binding():
    """Two wildcards locked to the same seed but binding different vars
    don't always pick the same option — derived seed is keyed on binding."""
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta",  "weight": 1},
        {"id": "c", "value": "gamma", "weight": 1},
    ])
    out_x = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": 7},
        ctx=_ctx(seed=0),
    )
    out_y = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$y", "locked_seed": 7},
        ctx=_ctx(seed=0),
    )
    # Both deterministic individually but collectively over many
    # bindings the picks distribute. Sanity-check at least one
    # combination produces different values.
    out_z = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$z", "locked_seed": 7},
        ctx=_ctx(seed=0),
    )
    out_w = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$w", "locked_seed": 7},
        ctx=_ctx(seed=0),
    )
    picks = {out_x["$x"], out_y["$y"], out_z["$z"], out_w["$w"]}
    # 4 different bindings + 3 options → near-certainly hits ≥2 distinct.
    assert len(picks) >= 2


def test_resolve_lock_with_chain_seed_reproduces_unlocked_pick():
    """Lock contract: locking a wildcard with `locked_seed = chain_seed`
    of a prior unlocked run reproduces that run's roll exactly. This
    is what makes the lock UX work — user sees a roll, locks it, the
    next run produces the same roll.

    Pre-fix: unlocked rolls used `random.Random(chain_seed)` directly
    while locked rolls derived via sha256 → different streams →
    locked output never matched unlocked even with identical seeds.
    """
    payload = _payload([
        {"id": "o1", "value": "a {red|blue|green} shirt", "weight": 1},
        {"id": "o2", "value": "a {denim|silk} suit", "weight": 1},
    ])
    chain_seed = 42
    # Run unlocked at chain=42.
    ctx_unlocked = _ctx(seed=chain_seed)
    unlocked = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x"},
        ctx=ctx_unlocked,
    )["$x"]
    # Run locked to that exact chain seed at a DIFFERENT chain seed.
    ctx_locked = _ctx(seed=999)
    locked = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": chain_seed},
        ctx=ctx_locked,
    )["$x"]
    assert unlocked == locked, f"lock failed to reproduce: {unlocked} != {locked}"


def test_resolve_locked_seed_freezes_inline_pick_inside_option():
    """Locking must freeze BOTH the option pick AND any inline-pick
    syntax (`{a|b|c}`) inside the chosen option's value. Pre-fix bug:
    `build_resolve_ctx` was called BEFORE the rng swap, so it captured
    the chain rng and the inline pick still rolled randomly across
    runs even though the option pick was locked."""
    payload = _payload([
        {"id": "o1", "value": "a {red|blue|green} shirt", "weight": 1},
    ])
    picks = set()
    for chain_seed in (1, 42, 99, 12345, 999_999_999):
        ctx = _ctx(seed=chain_seed)
        out = WildcardHandler.resolve(
            payload,
            instance={"variable_binding": "$x", "locked_seed": 7777},
            ctx=ctx,
        )
        picks.add(out["$x"])
    # Locking should make the inline {a|b|c} resolution deterministic
    # too — every chain seed produces the SAME output.
    assert len(picks) == 1, f"expected 1 unique pick, got {picks}"


def test_resolve_locked_seed_invalid_falls_back_to_ctx_rng():
    """Malformed locked_seed (string, etc.) silently falls back to the
    chain RNG instead of crashing the pipeline."""
    ctx = _ctx(seed=1)  # → alpha at 50/50
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta",  "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "locked_seed": "not-an-int"},
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}  # behaves as if no lock was set


def test_resolve_pinned_mode_picks_specified_option():
    """mode=pinned + pinned_option_id → handler short-circuits RNG."""
    ctx = _ctx(seed=0)  # would normally pick beta
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 99},  # heavy
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "mode": "pinned",
            "pinned_option_id": "a",
        },
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_resolve_pinned_mode_falls_back_when_pinned_id_missing():
    """If the pinned id no longer exists, fall through to random pick."""
    ctx = _ctx(seed=1)  # → alpha under random
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "mode": "pinned",
            "pinned_option_id": "ghost",  # not present
        },
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}  # fell through to RNG


def test_resolve_pinned_mode_resolves_inline_syntax():
    """Pinned option's value still goes through resolve_text."""
    # Use alternation instead of $var — wildcard surface no longer
    # supports $var reads (binding producer, not consumer); see
    # combine v2 + syntax parity cycle. Pinned mode picks the named
    # option deterministically, then resolve_text expands inline
    # syntax that IS supported on wildcard surface (alternations,
    # escapes, nested wildcard refs).
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": {},
    }
    payload = _payload([
        # Two-branch alternation that always resolves to "red" — exercises
        # the resolve_text composition path without depending on $var
        # (which wildcard surface no longer supports).
        {"id": "a", "value": "{red|red} shirt", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "mode": "pinned",
            "pinned_option_id": "a",
        },
        ctx=ctx,
    )
    assert out == {"$x": "red shirt"}


def test_resolve_random_mode_explicit_behaves_like_default():
    """mode=random == mode unset (legacy): weighted RNG over enabled."""
    ctx = _ctx(seed=1)  # → alpha
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "mode": "random"},
        ctx=ctx,
    )
    assert out == {"$x": "alpha"}


def test_resolve_option_weights_does_not_mutate_payload():
    """Override path shallow-copies options so the snapshot stays clean."""
    ctx = _ctx(seed=0)
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    WildcardHandler.resolve(
        payload,
        instance={
            "variable_binding": "$x",
            "option_weights": {"a": 99.0},
        },
        ctx=ctx,
    )
    # Payload's option dict still holds the original weight.
    assert payload["options"][0]["weight"] == 1
