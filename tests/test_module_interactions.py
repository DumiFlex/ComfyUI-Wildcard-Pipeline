"""Cross-module interaction integration tests.

Exercises real PipelineEngine runs that combine multiple module kinds.
Goal: catch regressions where a single handler works in isolation but
breaks when downstream modules consume its bindings, when a constraint
fires on a not-yet-picked source, when nested ``@{}`` refs cycle, etc.

These are NOT pure unit tests — they spin up the real
``PipelineEngine`` and assert end-to-end behavior on the resulting
context. Each test is intentionally small + named after the scenario
it covers so a future failure points at the exact interaction that
broke.
"""
from __future__ import annotations

from typing import Any

from engine.context import strip_internals
from engine.pipeline import PipelineEngine


def _wildcard(mid: str, binding: str, options: list[dict], **inst) -> dict:
    return {
        "id": mid, "type": "wildcard", "enabled": True,
        "payload": {
            "var_binding": binding,
            "options": options,
            "sub_categories": [],
        },
        "instance": inst,
    }


def _fixed(mid: str, values: list[dict], **inst) -> dict:
    return {
        "id": mid, "type": "fixed_values", "enabled": True,
        "payload": {"values": values},
        "instance": inst,
    }


def _combine(mid: str, template: str, output_var: str, **inst) -> dict:
    return {
        "id": mid, "type": "combine", "enabled": True,
        "payload": {
            "template": template, "output_var": output_var,
            "input_vars": [],
        },
        "instance": inst,
    }


def _derivation(mid: str, rules: list[dict], **inst) -> dict:
    return {
        "id": mid, "type": "derivation", "enabled": True,
        "payload": {"rules": rules},
        "instance": inst,
    }


def _constraint(mid: str, source: str, target: str, matrix=None, exceptions=None, **inst) -> dict:
    return {
        "id": mid, "type": "constraint", "enabled": True,
        "payload": {
            "source_wildcard_id": source,
            "target_wildcard_id": target,
            "matrix": matrix or {},
            "exceptions": exceptions or [],
        },
        "instance": inst,
    }


def _run(
    modules: list[dict], *, seed: int = 0, ctx: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return PipelineEngine().run(modules, ctx=ctx, seed=seed)  # type: ignore[arg-type]


# ─── Producer → Consumer chains ──────────────────────────────────────


class TestProducerConsumer:
    """One module writes a $var, the next reads it."""

    def test_fixed_values_feeds_combine_template(self):
        ctx = _run([
            _fixed("fv1", [
                {"id": "v1", "name": "color", "value": "red"},
                {"id": "v2", "name": "mood", "value": "calm"},
            ]),
            _combine("cmb1", "a $color $mood sky", "prompt"),
        ])
        assert ctx["color"] == "red"
        assert ctx["mood"] == "calm"
        assert ctx["prompt"] == "a red calm sky"

    def test_wildcard_feeds_combine_template(self):
        ctx = _run([
            _wildcard("w1", "hair", [{"id": "o1", "value": "blonde", "weight": 1}]),
            _combine("cmb1", "a $hair person", "prompt"),
        ], seed=42)
        assert ctx["hair"] == "blonde"
        assert ctx["prompt"] == "a blonde person"

    def test_combine_feeds_combine(self):
        """First combine writes $phrase, second reads it via $phrase token."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "noun", "value": "knight"}]),
            _combine("cmb1", "a brave $noun", "phrase"),
            _combine("cmb2", "$phrase in armor", "final"),
        ])
        assert ctx["phrase"] == "a brave knight"
        assert ctx["final"] == "a brave knight in armor"

    def test_combine_feeds_derivation_condition(self):
        """Combine writes $mood; derivation reads $mood via condition."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "weather", "value": "stormy"}]),
            _combine("cmb", "$weather", "mood"),
            _derivation("der", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "mood", "op": "equals", "value": "stormy"},
                    "action": {"target_var": "lighting", "mode": "replace", "value": "dramatic"},
                }],
            }]),
        ])
        assert ctx["mood"] == "stormy"
        assert ctx["lighting"] == "dramatic"

    def test_derivation_feeds_combine(self):
        """Derivation writes $tone; combine reads it."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "age", "value": "30"}]),
            _derivation("der", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "age", "op": "equals", "value": "30"},
                    "action": {"target_var": "tone", "mode": "replace", "value": "serious"},
                }],
            }]),
            _combine("cmb", "$tone face", "phrase"),
        ])
        assert ctx["tone"] == "serious"
        assert ctx["phrase"] == "serious face"


# ─── Wildcard ↔ Constraint ───────────────────────────────────────────


class TestWildcardConstraint:
    """Constraint modules adjust a target wildcard's option weights based
    on what its source wildcard already picked."""

    def test_exception_excludes_specific_pair(self):
        """Source picks 'long_hair'; exception excludes target 'punk' →
        target falls back to the other option.

        Chain order is load-bearing: src runs first (records its pick),
        constraint runs second (registers into __wp_constraints__), tgt
        runs third (reads the constraint + the source pick at roll time).
        """
        ctx = _run([
            _wildcard("src", "hair", [
                {"id": "h1", "value": "long_hair", "weight": 1},
            ]),
            _constraint("c1", source="src", target="tgt", exceptions=[
                {"source": "long_hair", "target": "punk", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("tgt", "style", [
                {"id": "s1", "value": "punk", "weight": 1},
                {"id": "s2", "value": "classic", "weight": 1},
            ]),
        ], seed=1)
        assert ctx["hair"] == "long_hair"
        assert ctx["style"] == "classic"  # punk excluded by constraint

    def test_constraint_source_after_target_warns(self):
        """Constraint targets a wildcard whose source HASN'T been picked
        yet — engine skips application + emits unknown_constraint_source.

        Order: constraint first (registers), target second (reads + finds
        no source pick), source last (never consulted by target).
        """
        ctx = _run([
            _constraint("c1", source="src", target="tgt", exceptions=[
                {"source": "long_hair", "target": "punk", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("tgt", "style", [
                {"id": "s1", "value": "punk", "weight": 1},
                {"id": "s2", "value": "classic", "weight": 1},
            ]),
            _wildcard("src", "hair", [
                {"id": "h1", "value": "long_hair", "weight": 1},
            ]),
        ], seed=1)
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "unknown_constraint_source" in warning_types

    def test_constraint_excludes_all_options_warns_and_falls_back(self):
        """Exception list excludes every target option → engine emits
        constraint_excludes_all_options + falls back to options[0]."""
        ctx = _run([
            _wildcard("src", "hair", [{"id": "h1", "value": "long_hair", "weight": 1}]),
            _constraint("c1", source="src", target="tgt", exceptions=[
                {"source": "long_hair", "target": "punk", "mode": "exclude", "factor": 0},
                {"source": "long_hair", "target": "classic", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("tgt", "style", [
                {"id": "s1", "value": "punk", "weight": 1},
                {"id": "s2", "value": "classic", "weight": 1},
            ]),
        ], seed=1)
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "constraint_excludes_all_options" in warning_types
        assert ctx["style"] == "punk"  # falls back to options[0]


# ─── Nested @{} refs (wildcard option contains @{other_uuid}) ────────


class TestNestedRefs:
    """Wildcard option values can carry @{uuid} refs to other wildcards.
    Engine walks them via the __wp_catalog__ at resolve time."""

    def test_wildcard_option_references_catalog_wildcard(self):
        """Option value `@{xyz}` resolves to xyz's picked option value."""
        catalog = {
            "abc12345": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [{"id": "c1", "value": "red", "weight": 1}],
            },
        }
        ctx = _run([
            _wildcard("outer", "outfit", [
                {"id": "o1", "value": "@{abc12345} dress", "weight": 1},
            ]),
        ], ctx={"__wp_catalog__": catalog}, seed=7)
        assert ctx["outfit"] == "red dress"

    def test_ref_to_missing_uuid_emits_warning(self):
        """Catalog miss → leniency: render the literal token + warn."""
        ctx = _run([
            _wildcard("outer", "outfit", [
                {"id": "o1", "value": "@{deadbeef} dress", "weight": 1},
            ]),
        ], ctx={"__wp_catalog__": {}}, seed=7)
        assert "dress" in ctx["outfit"]
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert any("ref" in t.lower() or "unknown" in t.lower() for t in warning_types)


# ─── Instance overrides ──────────────────────────────────────────────


class TestInstanceOverrides:
    def test_wildcard_variable_binding_override_rebinds(self):
        """instance.variable_binding overrides payload.var_binding."""
        ctx = _run([
            _wildcard("w1", "color", [{"id": "o1", "value": "red", "weight": 1}],
                      variable_binding="my_alias"),
        ], seed=1)
        assert ctx.get("my_alias") == "red"
        assert "color" not in strip_internals(ctx)

    def test_wildcard_pinned_mode_picks_specific_option(self):
        """instance.mode='pinned' + pinned_option_id picks that exact id."""
        ctx = _run([
            _wildcard("w1", "color", [
                {"id": "o1", "value": "red", "weight": 1},
                {"id": "o2", "value": "blue", "weight": 99},  # higher weight, would normally win
                {"id": "o3", "value": "green", "weight": 1},
            ], mode="pinned", pinned_option_id="o3"),
        ], seed=1)
        assert ctx["color"] == "green"

    def test_wildcard_enabled_options_narrows_pool(self):
        """instance.enabled_options restricts which options can be picked."""
        ctx = _run([
            _wildcard("w1", "color", [
                {"id": "o1", "value": "red", "weight": 1},
                {"id": "o2", "value": "blue", "weight": 1},
                {"id": "o3", "value": "green", "weight": 1},
            ], enabled_options=["o2"]),
        ], seed=1)
        assert ctx["color"] == "blue"

    def test_wildcard_enabled_options_empty_yields_empty_string(self):
        """All options disabled → binding still set, but to empty string."""
        ctx = _run([
            _wildcard("w1", "color", [
                {"id": "o1", "value": "red", "weight": 1},
            ], enabled_options=[]),
        ], seed=1)
        assert ctx["color"] == ""

    def test_combine_template_override_replaces_payload(self):
        """instance.template_override wins over payload.template."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "noun", "value": "knight"}]),
            _combine("cmb", "old: $noun", "phrase", template_override="new: $noun"),
        ])
        assert ctx["phrase"] == "new: knight"

    def test_combine_variable_binding_override_rebinds_output(self):
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "noun", "value": "knight"}]),
            _combine("cmb", "a $noun", "phrase", variable_binding="renamed_phrase"),
        ])
        assert ctx["renamed_phrase"] == "a knight"
        assert "phrase" not in strip_internals(ctx)

    def test_fixed_values_overrides_replace_payload(self):
        """instance.values_overrides fully replaces payload.values."""
        ctx = _run([{
            "id": "fv1", "type": "fixed_values", "enabled": True,
            "payload": {"values": [{"id": "v1", "name": "color", "value": "red"}]},
            "instance": {
                "values_overrides": [
                    {"id": "v1", "name": "color", "value": "blue"},
                    {"id": "v2", "name": "mood", "value": "wild"},
                ],
            },
        }])
        assert ctx["color"] == "blue"
        assert ctx["mood"] == "wild"


# ─── Internal flag ───────────────────────────────────────────────────


class TestInternalFlag:
    def test_internal_wildcard_visible_to_downstream_but_stripped_at_boundary(self):
        """Internal scratch var is readable by other modules in same chain
        but `strip_internals` drops it at the socket boundary."""
        ctx = _run([
            _wildcard("scratch", "mood", [
                {"id": "o1", "value": "calm", "weight": 1},
            ], internal=True),
            _combine("public", "a $mood face", "phrase"),
        ], seed=1)
        # Both vars are in ctx for the chain.
        assert ctx["mood"] == "calm"
        assert ctx["phrase"] == "a calm face"
        # After strip — internal `mood` is gone, public `phrase` survives.
        public = strip_internals(ctx)
        assert "mood" not in public
        assert public["phrase"] == "a calm face"


# ─── Locked seed reproducibility ─────────────────────────────────────


class TestSeedLock:
    def test_locked_seed_pins_pick_across_runs(self):
        """Two runs with the same locked_seed produce identical picks
        regardless of the chain seed."""
        options = [
            {"id": "o1", "value": "red", "weight": 1},
            {"id": "o2", "value": "blue", "weight": 1},
            {"id": "o3", "value": "green", "weight": 1},
        ]
        ctx1 = _run([_wildcard("w1", "color", options, locked_seed=999)], seed=1)
        ctx2 = _run([_wildcard("w1", "color", options, locked_seed=999)], seed=2)
        ctx3 = _run([_wildcard("w1", "color", options, locked_seed=999)], seed=3)
        assert ctx1["color"] == ctx2["color"] == ctx3["color"]

    def test_unlocked_pick_varies_with_chain_seed(self):
        """Without lock, different chain seeds can produce different picks."""
        options = [
            {"id": "o1", "value": "red", "weight": 1},
            {"id": "o2", "value": "blue", "weight": 1},
            {"id": "o3", "value": "green", "weight": 1},
        ]
        picks: set[str] = set()
        for seed in range(20):
            ctx = _run([_wildcard("w1", "color", options)], seed=seed)
            picks.add(ctx["color"])
        # 20 distinct seeds should produce at least 2 different picks
        # (vanishingly small probability of all 20 picking the same option).
        assert len(picks) >= 2


# ─── Disabled module + ordering ──────────────────────────────────────


class TestDisabledAndOrdering:
    def test_disabled_module_does_not_write(self):
        """Disabled wildcard contributes nothing to ctx; trace records skip."""
        ctx = _run([
            {**_wildcard("w1", "color", [{"id": "o1", "value": "red", "weight": 1}]),
             "enabled": False},
            _combine("cmb", "color is $color", "phrase"),
        ])
        # `$color` resolves to empty (or literal) since w1 didn't write it.
        assert "color" not in strip_internals(ctx) or strip_internals(ctx)["color"] == ""
        # Trace records w1 as skipped_disabled.
        trace_by_id = {t["id"]: t for t in ctx["__wp_trace__"]}
        assert trace_by_id["w1"]["status"] == "skipped_disabled"

    def test_last_write_wins_when_two_modules_target_same_var(self):
        """Second module's write overwrites the first's value for the same var."""
        ctx = _run([
            _fixed("fv1", [{"id": "v1", "name": "color", "value": "red"}]),
            _fixed("fv2", [{"id": "v1", "name": "color", "value": "blue"}]),
        ])
        assert ctx["color"] == "blue"
        # Trace marks the second write as overwrite=True.
        fv2_trace = next(t for t in ctx["__wp_trace__"] if t["id"] == "fv2")
        color_write = next(w for w in fv2_trace["writes"] if w["variable"] == "color")
        assert color_write["overwrite"] is True


# ─── Derivation rules with sequencing ────────────────────────────────


class TestDerivationSequencing:
    def test_derivation_rule_sees_earlier_rule_writes(self):
        """Two rules in one derivation; second checks the var set by first."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "age", "value": "30"}]),
            _derivation("der", [
                {
                    "id": "r1",
                    "branches": [{
                        "condition": {"var": "age", "op": "equals", "value": "30"},
                        "action": {"target_var": "tier", "mode": "replace", "value": "adult"},
                    }],
                },
                {
                    "id": "r2",
                    "branches": [{
                        "condition": {"var": "tier", "op": "equals", "value": "adult"},
                        "action": {"target_var": "wisdom", "mode": "replace", "value": "moderate"},
                    }],
                },
            ]),
        ])
        assert ctx["tier"] == "adult"
        assert ctx["wisdom"] == "moderate"

    def test_derivation_else_fires_when_no_branch_matches(self):
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "age", "value": "99"}]),
            _derivation("der", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "age", "op": "equals", "value": "30"},
                    "action": {"target_var": "tier", "mode": "replace", "value": "adult"},
                }],
                "else": {
                    "action": {"target_var": "tier", "mode": "replace", "value": "unknown"},
                },
            }]),
        ])
        assert ctx["tier"] == "unknown"

    def test_derivation_append_mode_concatenates(self):
        ctx = _run([
            _fixed("fv", [
                {"id": "v1", "name": "base", "value": "hello"},
                {"id": "v2", "name": "flag", "value": "yes"},
            ]),
            _derivation("der", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "flag", "op": "equals", "value": "yes"},
                    "action": {"target_var": "base", "mode": "append", "value": " world"},
                }],
            }]),
        ])
        assert ctx["base"] == "hello world"

    def test_derivation_presence_check_exists_op(self):
        """`exists` op fires when the var is present in ctx, regardless of value."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "marker", "value": ""}]),  # empty but set
            _derivation("der", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "marker", "op": "exists", "value": ""},
                    "action": {"target_var": "found", "mode": "replace", "value": "yes"},
                }],
            }]),
        ])
        assert ctx["found"] == "yes"


# ─── Downstream Context chain ────────────────────────────────────────


class TestDownstreamContextChain:
    """Two Context nodes in series — downstream reads upstream's ctx."""

    def test_downstream_overrides_upstream_var(self):
        upstream = _run([
            _fixed("up", [
                {"id": "v1", "name": "color", "value": "red"},
                {"id": "v2", "name": "noun", "value": "dragon"},
            ]),
        ])
        # Strip internals before threading into downstream (mimics WP_Context boundary)
        downstream_start = strip_internals(upstream)
        downstream = _run([
            _fixed("down", [{"id": "v1", "name": "color", "value": "blue"}]),
            _combine("cmb", "$color $noun", "prompt"),
        ], ctx=downstream_start)
        assert downstream["color"] == "blue"  # overridden
        assert downstream["noun"] == "dragon"  # passed through
        assert downstream["prompt"] == "blue dragon"


# ─── Inline syntax inside option values ──────────────────────────────


class TestInlineSyntaxInValues:
    """resolve_text runs on every picked option value, so $var reads
    and {a|b|c} alternations inside option strings work."""

    def test_wildcard_option_rejects_dollar_var_read(self):
        """Wildcard is a PRODUCER surface — $var reads are gated off
        (see engine/syntax/resolve.py). Lenient mode renders the
        literal token + emits a var_out_of_surface warning so the
        user gets a signal instead of silent leakage."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "color", "value": "red"}]),
            _wildcard("w1", "phrase", [
                {"id": "o1", "value": "$color tone", "weight": 1},
            ]),
        ], seed=1)
        # Literal token rendered (not expanded) — confirms surface gate.
        assert ctx["phrase"] == "$color tone"
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "var_out_of_surface" in warning_types

    def test_wildcard_option_inline_alternation_resolves(self):
        """Option value `{a|b|c}` resolves to one of a/b/c via per-module rng."""
        # Use a single option so the wildcard always picks it, then check
        # the alternation resolved to one of the expected branches.
        ctx = _run([
            _wildcard("w1", "mood", [
                {"id": "o1", "value": "{calm|wild|serene}", "weight": 1},
            ]),
        ], seed=1)
        assert ctx["mood"] in ("calm", "wild", "serene")

    def test_combine_template_with_inline_alternation(self):
        """{a|b|c} inside a combine template resolves at run time."""
        ctx = _run([
            _fixed("fv", [{"id": "v1", "name": "subject", "value": "knight"}]),
            _combine("cmb", "a {brave|noble|fierce} $subject", "phrase"),
        ])
        # All three branches should produce a valid string with the subject.
        assert ctx["phrase"].endswith("knight")
        assert any(adj in ctx["phrase"] for adj in ("brave", "noble", "fierce"))


# ─── Constraint composition ──────────────────────────────────────────


class TestConstraintComposition:
    """First-instance one-shot semantic (2026-05-24 redesign): each
    constraint module fires on exactly one downstream target instance,
    in chain order. Multiple constraints targeting the same wildcard
    do NOT compose multiplicatively on a single target instance — the
    first claims, the second waits for the next target instance."""

    def test_two_constraints_one_target_only_first_fires(self):
        """Two excludes targeting the same wildcard + ONE target
        instance: c1 fires on `tgt`, c2 is unconsumed → emits
        `constraint_never_applied` warning at chain end. c1's exclude
        of `punk` leaves `classic` available."""
        ctx = _run([
            _wildcard("src1", "hair", [{"id": "h1", "value": "long", "weight": 1}]),
            _wildcard("src2", "eyes", [{"id": "e1", "value": "blue", "weight": 1}]),
            _constraint("c1", source="src1", target="tgt", exceptions=[
                {"source": "long", "target": "punk", "mode": "exclude", "factor": 0},
            ]),
            _constraint("c2", source="src2", target="tgt", exceptions=[
                {"source": "blue", "target": "classic", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("tgt", "style", [
                {"id": "s1", "value": "punk", "weight": 1},
                {"id": "s2", "value": "classic", "weight": 1},
            ]),
        ], seed=1)
        # c1 alone fires on the single tgt instance → punk excluded →
        # classic survives. No excludes-all (one option still has weight).
        assert ctx["style"] == "classic"
        # `constraint_never_applied` warning for c2 is covered separately
        # in tests/test_constraint_first_instance.py (Task 5).


# ─── Locked-seed reproducibility across a full chain ─────────────────


class TestChainReproducibility:
    def test_full_locked_chain_reproduces_identically(self):
        """Every wildcard locked → identical output across runs regardless
        of chain seed."""
        modules = [
            _wildcard("w1", "color", [
                {"id": "o1", "value": "red", "weight": 1},
                {"id": "o2", "value": "blue", "weight": 1},
            ], locked_seed=111),
            _wildcard("w2", "shape", [
                {"id": "o1", "value": "round", "weight": 1},
                {"id": "o2", "value": "square", "weight": 1},
            ], locked_seed=222),
            _combine("cmb", "$color $shape", "phrase"),
        ]
        c1 = _run(modules, seed=999)
        c2 = _run(modules, seed=1)
        c3 = _run(modules, seed=42)
        assert c1["phrase"] == c2["phrase"] == c3["phrase"]
        assert c1["color"] == c2["color"] == c3["color"]
        assert c1["shape"] == c2["shape"] == c3["shape"]


# ─── Realistic kitchen-sink scenario ─────────────────────────────────


class TestNestedConstraints:
    """2026-05-19 cycle — constraints now apply to wildcards reached via
    nested `@{uuid}` refs, not just chain-level wildcards. Pre-fix the
    matrix silently bypassed when target was buried inside another
    wildcard's option value."""

    def test_constraint_applies_to_nested_target(self):
        """Outer wildcard's option is `@{nested}`. Constraint excludes
        nested='forbidden' when src='trigger'. Expect: nested rolls
        'allowed', never 'forbidden', across many seeds.

        Pre-fix: constraint silently bypassed → 'forbidden' appeared.
        Post-fix: constraint applied during ref resolution.
        """
        catalog = {
            "bbbbbbbb": {
                "type": "wildcard",
                "var_binding": "inner",
                "options": [
                    {"id": "b1", "value": "forbidden", "weight": 1},
                    {"id": "b2", "value": "allowed", "weight": 1},
                ],
            },
        }
        modules = [
            _wildcard("srcwild", "src", [
                {"id": "s1", "value": "trigger", "weight": 1},
            ]),
            _constraint("c1", source="srcwild", target="bbbbbbbb", exceptions=[
                {"source": "trigger", "target": "forbidden", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("outer", "final", [
                {"id": "o1", "value": "@{bbbbbbbb}", "weight": 1},
            ]),
        ]
        # Run many seeds; with constraint working, "forbidden" never appears.
        picks: set[str] = set()
        for seed in range(40):
            ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=seed)
            picks.add(ctx["final"])
        assert "forbidden" not in picks
        assert "allowed" in picks  # confirm pool wasn't accidentally empty

    def test_nested_constraint_excludes_all_emits_warning(self):
        """Exceptions exclude every option of the nested target →
        ref resolver falls back to options[0] + emits the
        constraint_excludes_all_options warning (same path as chain-
        level wildcards)."""
        catalog = {
            "cccccccc": {
                "type": "wildcard",
                "var_binding": "inner",
                "options": [
                    {"id": "c1", "value": "punk", "weight": 1},
                    {"id": "c2", "value": "classic", "weight": 1},
                ],
            },
        }
        modules = [
            _wildcard("srcwild", "src", [
                {"id": "s1", "value": "trigger", "weight": 1},
            ]),
            _constraint("c1", source="srcwild", target="cccccccc", exceptions=[
                {"source": "trigger", "target": "punk", "mode": "exclude", "factor": 0},
                {"source": "trigger", "target": "classic", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("outer", "final", [
                {"id": "o1", "value": "@{cccccccc}", "weight": 1},
            ]),
        ]
        ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=1)
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "constraint_excludes_all_options" in warning_types

    def test_nested_constraint_warns_when_source_not_picked(self):
        """Source wildcard sits after the outer wildcard that nests the
        constraint's target → at nested-roll time the source's pick
        isn't in __wp_picks__ yet → emits unknown_constraint_source.

        Sanity check that the warning surface is consistent between
        chain-level and nested constraint application paths."""
        catalog = {
            "dddddddd": {
                "type": "wildcard",
                "var_binding": "inner",
                "options": [{"id": "d1", "value": "x", "weight": 1}],
            },
        }
        modules = [
            _constraint("c1", source="srcwild", target="dddddddd", exceptions=[
                {"source": "trigger", "target": "x", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("outer", "final", [
                {"id": "o1", "value": "@{dddddddd}", "weight": 1},
            ]),
            _wildcard("srcwild", "src", [
                {"id": "s1", "value": "trigger", "weight": 1},
            ]),
        ]
        ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=1)
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "unknown_constraint_source" in warning_types


class TestNestedSubcategoryFilter:
    """`@{uuid:subcat,subcat2}` per-call sub-category filter — restricts
    the nested wildcard's pick to options whose `sub_category` matches.
    Same semantics as chain-level `instance.category_filter` but scoped
    per call site so one library wildcard can be narrowed differently
    from each reference."""

    def test_subcat_filter_narrows_pool(self):
        """`@{color:warm}` should only pick from options whose
        sub_category == 'warm', skipping cool options entirely."""
        catalog = {
            "eeeeeeee": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [
                    {"id": "c1", "value": "red", "weight": 1, "sub_category": "warm"},
                    {"id": "c2", "value": "yellow", "weight": 1, "sub_category": "warm"},
                    {"id": "c3", "value": "blue", "weight": 1, "sub_category": "cool"},
                    {"id": "c4", "value": "green", "weight": 1, "sub_category": "cool"},
                ],
            },
        }
        modules = [
            _wildcard("outer", "phrase", [
                {"id": "o1", "value": "@{eeeeeeee:warm}", "weight": 1},
            ]),
        ]
        picks: set[str] = set()
        for seed in range(30):
            ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=seed)
            picks.add(ctx["phrase"])
        assert picks.issubset({"red", "yellow"})
        assert "blue" not in picks
        assert "green" not in picks

    def test_subcat_filter_multi_categories(self):
        """Comma-separated subcats accept union of matching options."""
        catalog = {
            "ffffffff": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [
                    {"id": "c1", "value": "red", "weight": 1, "sub_category": "warm"},
                    {"id": "c2", "value": "blue", "weight": 1, "sub_category": "cool"},
                    {"id": "c3", "value": "green", "weight": 1, "sub_category": "earth"},
                ],
            },
        }
        modules = [
            _wildcard("outer", "phrase", [
                {"id": "o1", "value": "@{ffffffff:warm,cool}", "weight": 1},
            ]),
        ]
        picks: set[str] = set()
        for seed in range(30):
            ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=seed)
            picks.add(ctx["phrase"])
        assert picks.issubset({"red", "blue"})
        assert "green" not in picks

    def test_subcat_filter_empty_pool_warns(self):
        """Filter matching no options → empty string output + warning."""
        catalog = {
            "aaaa1111": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [
                    {"id": "c1", "value": "red", "weight": 1, "sub_category": "warm"},
                ],
            },
        }
        modules = [
            _wildcard("outer", "phrase", [
                {"id": "o1", "value": "[@{aaaa1111:nonexistent}]", "weight": 1},
            ]),
        ]
        ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=1)
        # Outer renders the literal brackets with empty ref result inside
        assert ctx["phrase"] == "[]"
        warning_types = [w["type"] for w in ctx["__wp_warnings__"]]
        assert "ref_subcategory_empty_pool" in warning_types

    def test_empty_filter_equivalent_to_no_filter(self):
        """`@{uuid:}` with empty subcat list = full pool (defensive
        against trailing-colon typos breaking everything)."""
        catalog = {
            "aaaa2222": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [
                    {"id": "c1", "value": "red", "weight": 1, "sub_category": "warm"},
                ],
            },
        }
        modules = [
            _wildcard("outer", "phrase", [
                {"id": "o1", "value": "@{aaaa2222:}", "weight": 1},
            ]),
        ]
        ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=1)
        assert ctx["phrase"] == "red"

    def test_subcat_filter_composes_with_constraint(self):
        """`@{color:warm}` + constraint excluding 'red' → only 'yellow'
        survives. Confirms filter applies BEFORE constraint, both
        compose correctly."""
        catalog = {
            "aaaa3333": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [
                    {"id": "c1", "value": "red", "weight": 1, "sub_category": "warm"},
                    {"id": "c2", "value": "yellow", "weight": 1, "sub_category": "warm"},
                    {"id": "c3", "value": "blue", "weight": 1, "sub_category": "cool"},
                ],
            },
        }
        modules = [
            _wildcard("srcwild", "src", [
                {"id": "s1", "value": "trigger", "weight": 1},
            ]),
            _constraint("c1", source="srcwild", target="aaaa3333", exceptions=[
                {"source": "trigger", "target": "red", "mode": "exclude", "factor": 0},
            ]),
            _wildcard("outer", "phrase", [
                {"id": "o1", "value": "@{aaaa3333:warm}", "weight": 1},
            ]),
        ]
        picks: set[str] = set()
        for seed in range(30):
            ctx = _run(modules, ctx={"__wp_catalog__": catalog}, seed=seed)
            picks.add(ctx["phrase"])
        assert picks == {"yellow"}


class TestKitchenSink:
    """End-to-end scenario combining most module kinds — the kind of
    pipeline a real user authors. If this test breaks, something
    structural changed."""

    def test_fv_then_constrained_wildcards_then_derivation_then_combine(self):
        catalog = {
            "deadbeef": {
                "type": "wildcard",
                "var_binding": "accent_color",
                "options": [{"id": "ac1", "value": "gold", "weight": 1}],
            },
        }
        ctx = _run([
            # Static identity vars
            _fixed("identity", [
                {"id": "v1", "name": "subject", "value": "knight"},
                {"id": "v2", "name": "era", "value": "medieval"},
            ]),
            # Source wildcard
            _wildcard("hair_pick", "hair", [
                {"id": "h1", "value": "long", "weight": 1},
            ]),
            # Constraint between hair and style
            _constraint("c1", source="hair_pick", target="style_pick", exceptions=[
                {"source": "long", "target": "punk", "mode": "exclude", "factor": 0},
            ]),
            # Target wildcard with a nested @{} ref inside option value
            _wildcard("style_pick", "style", [
                {"id": "s1", "value": "punk", "weight": 1},
                {"id": "s2", "value": "@{deadbeef}-trimmed classic", "weight": 1},
            ]),
            # Derivation reads era and writes lighting
            _derivation("der1", [{
                "id": "r1",
                "branches": [{
                    "condition": {"var": "era", "op": "equals", "value": "medieval"},
                    "action": {"target_var": "lighting", "mode": "replace", "value": "torchlit"},
                }],
            }]),
            # Final combine reads everything
            _combine(
                "final",
                "$lighting portrait of a $hair-haired $subject in $style style",
                "prompt",
            ),
        ], ctx={"__wp_catalog__": catalog}, seed=42)

        # Hair forced (single option), style forced to non-excluded option,
        # derivation fired, combine concatenated.
        assert ctx["hair"] == "long"
        assert ctx["style"] == "gold-trimmed classic"
        assert ctx["lighting"] == "torchlit"
        assert ctx["prompt"] == (
            "torchlit portrait of a long-haired knight in gold-trimmed classic style"
        )
        # No warnings on the happy path.
        assert ctx["__wp_warnings__"] == []
