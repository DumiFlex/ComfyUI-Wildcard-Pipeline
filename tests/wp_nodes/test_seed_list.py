"""Node-level tests for WP_SeedList.

The node has THREE independent override toggles exposed through ONE
socketless DOM widget (``wp_seed_list_config``) carrying a JSON
payload:
  - ``override_seed``     → use loop_config's ``base_seed``.
  - ``override_count``    → use loop_config's ``count``.
  - ``override_strategy`` → use loop_config's ``strategy``.

All three must be off-by-default and independent, so the user can mix
sources (e.g. config-driven count + own strategy + separate base for
sampler seeds). Tests cover the per-field matrix plus defensive
fallbacks for malformed / unwired payloads, plus a 50-bit cap check
at the node boundary, plus a legacy-migration check for the
pre-split ``override_config`` flag.
"""

import json

from engine.seed_derive import MAX_SAFE_SEED, derive_loop_seeds
from wp_nodes.seed_list import WPSeedList, _parse_config, _resolve_config

# ----------------------------------------------------------- _parse_config


_DEFAULTS = {
    "strategy": "hash_index",
    "override_seed": False,
    "override_count": False,
    "override_strategy": False,
    "seed_locks": {},
}


def test_parse_config_defaults_on_none():
    assert _parse_config(None) == _DEFAULTS


def test_parse_config_defaults_on_empty_string():
    assert _parse_config("") == _DEFAULTS


def test_parse_config_defaults_on_malformed_json():
    assert _parse_config("not json") == _DEFAULTS


def test_parse_config_defaults_on_non_dict_json():
    assert _parse_config("[1, 2, 3]") == _DEFAULTS


def test_parse_config_unknown_strategy_falls_back_to_default():
    out = _parse_config(json.dumps({"strategy": "wat"}))
    assert out["strategy"] == "hash_index"


def test_parse_config_non_bool_overrides_coerce_to_bool():
    out = _parse_config(json.dumps({
        "override_seed": "yes",
        "override_count": 1,
        "override_strategy": [],
    }))
    # bool() coerces — "yes"/1 truthy, [] falsy. The parser normalises
    # to a plain bool so downstream consumers can rely on the type.
    assert isinstance(out["override_seed"], bool)
    assert isinstance(out["override_count"], bool)
    assert isinstance(out["override_strategy"], bool)


def test_parse_config_missing_fields_use_defaults():
    out = _parse_config(json.dumps({"strategy": "sequential"}))
    assert out == {**_DEFAULTS, "strategy": "sequential"}


def test_parse_config_accepts_dict():
    """The widget glue sometimes hands dicts straight through — verify
    the parser tolerates either string OR dict input shape."""
    out = _parse_config({"strategy": "prime_stride", "override_seed": True})
    assert out == {**_DEFAULTS, "strategy": "prime_stride", "override_seed": True}


def test_parse_config_full_valid_payload():
    raw = json.dumps({
        "strategy": "sequential",
        "override_seed": True,
        "override_count": True,
        "override_strategy": True,
    })
    assert _parse_config(raw) == {
        "strategy": "sequential",
        "override_seed": True,
        "override_count": True,
        "override_strategy": True,
        "seed_locks": {},
    }


def test_parse_config_independent_count_strategy_fields():
    """Splitting `override_config` lets the user enable one without the
    other — e.g. mirror the loop's count but pick own strategy."""
    raw = json.dumps({
        "override_count": True,
        "override_strategy": False,
    })
    out = _parse_config(raw)
    assert out["override_count"] is True
    assert out["override_strategy"] is False


def test_parse_config_legacy_override_config_mirrors_to_both_new_fields():
    """Workflows saved before the split carry the old `override_config`
    boolean. Parser must mirror it to BOTH new fields so pre-split
    workflows produce identical output post-split."""
    raw = json.dumps({"override_config": True})
    out = _parse_config(raw)
    assert out["override_count"] is True
    assert out["override_strategy"] is True


def test_parse_config_new_fields_win_over_legacy_override_config():
    """If both the legacy flag AND the new fields are present, the new
    explicit values win. Handles re-saves of mixed-shape workflows."""
    raw = json.dumps({
        "override_config": True,
        "override_count": False,
        "override_strategy": True,
    })
    out = _parse_config(raw)
    assert out["override_count"] is False
    assert out["override_strategy"] is True


# ----------------------------------------------------------- _resolve_config


def test_resolve_widgets_win_when_all_overrides_off():
    """Default state — all toggles off — widgets always win even when
    loop_config is wired. The toggles are explicit opt-in; a stale wire
    must never silently rewrite the user's widget values."""
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=False,
        override_count=False,
        override_strategy=False,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (42, 3, "hash_index")


def test_resolve_override_seed_only_pulls_base_from_config():
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=False,
        override_strategy=False,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (999, 3, "hash_index")


def test_resolve_override_count_only_pulls_count_from_config():
    """Count toggle independent from strategy toggle — flipping count
    only doesn't pull strategy from the config."""
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=False,
        override_count=True,
        override_strategy=False,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (42, 7, "hash_index")


def test_resolve_override_strategy_only_pulls_strategy_from_config():
    """Strategy toggle independent from count toggle."""
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=False,
        override_count=False,
        override_strategy=True,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (42, 3, "sequential")


def test_resolve_count_and_strategy_overrides_full_post_split_match():
    """Count + strategy on (the auto-on-wire-connect default) — full
    mirror of the loop's series shape, base stays on widget."""
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=False,
        override_count=True,
        override_strategy=True,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (42, 7, "sequential")


def test_resolve_all_three_overrides_full_mirror():
    """All toggles on + wired config — full mirror of the loop's
    series. Simplest "match the loop" setup."""
    loop_config = {"count": 7, "strategy": "sequential", "base_seed": 999}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=True,
        override_strategy=True,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (999, 7, "sequential")


def test_resolve_falls_back_per_field_on_unwired_loop_config():
    """All toggles on but loop_config=None — falls back to widget values
    for every field. Safer than crashing: the user might toggle an
    override on before wiring the socket."""
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=True,
        override_strategy=True,
        loop_config=None,
    )
    assert (base, count, strategy) == (42, 3, "hash_index")


def test_resolve_falls_back_per_field_on_malformed_values():
    """Each toggle independently validates its slice of the payload:
    bad count → widget count, bad strategy → widget strategy, bad
    base → widget base. Mirrors WP_ContextLoop._parse_config's per-
    field recovery so a corrupt upstream payload never crashes."""
    loop_config = {"count": -1, "strategy": "unknown", "base_seed": "abc"}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=True,
        override_strategy=True,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (42, 3, "hash_index")


def test_resolve_ignores_non_dict_loop_config():
    """A non-dict loop_config (e.g. a stray string from a broken wire)
    silently falls back to widgets — never raises."""
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=True,
        override_strategy=True,
        loop_config="not-a-dict",
    )
    assert (base, count, strategy) == (42, 3, "hash_index")


def test_resolve_override_seed_with_only_base_in_payload():
    """`override_seed` on, payload only has `base_seed` (no count /
    strategy). Per-field path: base wins, others on widgets."""
    loop_config = {"base_seed": 555}
    base, count, strategy = _resolve_config(
        base_seed=42,
        count=3,
        strategy="hash_index",
        override_seed=True,
        override_count=False,
        override_strategy=False,
        loop_config=loop_config,
    )
    assert (base, count, strategy) == (555, 3, "hash_index")


# --------------------------------------------------------------- execute()


def _seeds(output):
    """Helper — execute() returns io.NodeOutput; pull out the seeds."""
    return output.values[0]


def _cfg(
    strategy="hash_index",
    override_seed=False,
    override_count=False,
    override_strategy=False,
):
    """Helper — serialise the strategy + override toggles into the JSON
    payload the widget produces."""
    return json.dumps({
        "strategy": strategy,
        "override_seed": override_seed,
        "override_count": override_count,
        "override_strategy": override_strategy,
    })


def test_execute_widget_mode_matches_derive_loop_seeds():
    """All toggles off — series mirrors derive_loop_seeds called with
    widget values verbatim."""
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index"),
        loop_config=None,
    )
    assert _seeds(out) == derive_loop_seeds(42, 4, "hash_index")


def test_execute_widget_mode_ignores_wired_loop_config_when_all_off():
    """Even when loop_config carries radically different values, all
    toggles off means widgets stay in charge."""
    loop_config = {"count": 99, "strategy": "sequential", "base_seed": 7777}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index"),
        loop_config=loop_config,
    )
    assert _seeds(out) == derive_loop_seeds(42, 4, "hash_index")


def test_execute_override_seed_only_uses_config_base():
    loop_config = {"count": 99, "strategy": "sequential", "base_seed": 7777}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index", override_seed=True),
        loop_config=loop_config,
    )
    assert _seeds(out) == derive_loop_seeds(7777, 4, "hash_index")


def test_execute_override_count_only_uses_config_count():
    loop_config = {"count": 6, "strategy": "sequential", "base_seed": 7777}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index", override_count=True),
        loop_config=loop_config,
    )
    # count from config; strategy + base from widgets.
    assert _seeds(out) == derive_loop_seeds(42, 6, "hash_index")


def test_execute_override_strategy_only_uses_config_strategy():
    loop_config = {"count": 6, "strategy": "sequential", "base_seed": 7777}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index", override_strategy=True),
        loop_config=loop_config,
    )
    # strategy from config; count + base from widgets.
    assert _seeds(out) == derive_loop_seeds(42, 4, "sequential")


def test_execute_count_and_strategy_overrides_match_loop_shape():
    """The default wire-connect state (count + strategy auto-on, seed
    off). Series shape mirrors the loop but base stays on widget."""
    loop_config = {"count": 6, "strategy": "sequential", "base_seed": 7777}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(
            strategy="hash_index",
            override_count=True,
            override_strategy=True,
        ),
        loop_config=loop_config,
    )
    assert _seeds(out) == derive_loop_seeds(42, 6, "sequential")


def test_execute_all_overrides_full_mirror():
    loop_config = {"count": 6, "strategy": "sequential", "base_seed": 100}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(
            strategy="hash_index",
            override_seed=True,
            override_count=True,
            override_strategy=True,
        ),
        loop_config=loop_config,
    )
    assert _seeds(out) == derive_loop_seeds(100, 6, "sequential")


def test_execute_override_unwired_falls_back_to_widgets():
    """All toggles on but loop_config=None — must not crash; every
    field falls back to its widget value."""
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=_cfg(
            strategy="prime_stride",
            override_seed=True,
            override_count=True,
            override_strategy=True,
        ),
        loop_config=None,
    )
    assert _seeds(out) == derive_loop_seeds(42, 4, "prime_stride")


def test_execute_legacy_override_config_mirrors_to_both_new_fields():
    """Workflows saved with the pre-split flag still resolve the same
    series shape post-split — `override_config=True` mirrors to both
    count + strategy."""
    legacy = json.dumps({"strategy": "hash_index", "override_config": True})
    loop_config = {"count": 6, "strategy": "sequential", "base_seed": 100}
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config=legacy,
        loop_config=loop_config,
    )
    assert _seeds(out) == derive_loop_seeds(42, 6, "sequential")


def test_execute_emits_50_bit_safe_seeds_in_all_modes():
    """Regardless of which mode wins, derive_loop_seeds masks every
    emitted seed to MAX_SAFE_SEED. Asserts the cap survives through
    the node boundary."""
    out_widget = WPSeedList.execute(
        base_seed=2**60,
        count=4,
        wp_seed_list_config=_cfg(strategy="sequential"),
        loop_config=None,
    )
    for s in _seeds(out_widget):
        assert 0 <= s <= MAX_SAFE_SEED

    out_override = WPSeedList.execute(
        base_seed=0,
        count=4,
        wp_seed_list_config=_cfg(strategy="hash_index", override_seed=True),
        loop_config={"base_seed": 2**60},
    )
    for s in _seeds(out_override):
        assert 0 <= s <= MAX_SAFE_SEED


def test_execute_empty_widget_config_uses_defaults():
    """The widget defaults to ``"{}"`` for fresh nodes — every field
    falls back to defaults. With all override toggles off the series
    collapses to widget-only values."""
    out = WPSeedList.execute(
        base_seed=42,
        count=4,
        wp_seed_list_config="{}",
        loop_config={"count": 99, "base_seed": 7777, "strategy": "sequential"},
    )
    assert _seeds(out) == derive_loop_seeds(42, 4, "hash_index")


def test_schema_advertises_loop_config_input_as_optional():
    """Sanity: the loop_config socket is optional so the node runs
    standalone without forcing the user to wire ContextLoop in."""
    schema = WPSeedList.define_schema()
    loop_input = next(i for i in schema.inputs if i.name == "loop_config")
    assert loop_input.optional is True


def test_schema_advertises_seed_list_config_widget():
    """Sanity: the strategy + override toggles live in ONE socketless
    DOM widget — replaces the multiple separate stock widgets the
    user used to drag across."""
    schema = WPSeedList.define_schema()
    names = {i.name for i in schema.inputs}
    assert "wp_seed_list_config" in names
    cfg = next(i for i in schema.inputs if i.name == "wp_seed_list_config")
    assert cfg.type_name == "WP_SEED_LIST_CONFIG"
    assert cfg.socketless is True


def test_schema_seed_output_is_list_typed():
    """The output must be ``is_output_list=True`` so a downstream node
    with ``is_input_list=True`` fans the seed series out one-per-iteration."""
    schema = WPSeedList.define_schema()
    [seed_out] = schema.outputs
    assert seed_out.is_output_list is True
    assert seed_out.type_name == "INT"


# ---------------------------------------------------- seed_locks parsing / execute


def test_parse_config_reads_seed_locks():
    cfg = _parse_config(json.dumps({"seed_locks": {"0": 5, "2": 9}}))
    assert cfg["seed_locks"] == {0: 5, 2: 9}


def test_parse_config_defaults_seed_locks_empty():
    assert _parse_config("{}")["seed_locks"] == {}


def test_parse_config_drops_malformed_seed_locks():
    cfg = _parse_config(json.dumps({"seed_locks": {"x": "no", "1": 9}}))
    assert cfg["seed_locks"] == {1: 9}


def test_execute_output_reflects_seed_locks():
    # sequential base 10, count 3 -> [10, 11, 12]; lock index 1 -> 77
    raw = json.dumps({
        "strategy": "sequential",
        "override_seed": False,
        "override_count": False,
        "override_strategy": False,
        "seed_locks": {"1": 77},
    })
    out = WPSeedList.execute(
        base_seed=10,
        count=3,
        wp_seed_list_config=raw,
        loop_config=None,
    )
    seeds = _seeds(out)
    assert seeds == [10, 77, 12]
