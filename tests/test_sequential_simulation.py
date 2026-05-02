"""Sequential-chain simulation — fixed_values + wildcard + combine + derivation.

Goal: exercise the canvas-level scenarios the static-analysis warnings target.
Each test runs a full PipelineEngine pass against a synthesised module list
and asserts the resolved ctx + warning shape match what a user would get
from the corresponding canvas configuration.

Covers the post-5.5.6 fix paths:
    - combine emits ONLY its output_var (no auto-binding of input vars)
    - combine emits an `unknown_var` warning when its template references
      a var nothing upstream provided
    - derivation condition.var read against a missing upstream var still
      evaluates safely (empty string), branch never matches → else fires
    - derivation action.value `$var` substitution against a known var
    - last-write-wins ordering across mixed kinds
"""
from __future__ import annotations

from engine.context import strip_internals
from engine.pipeline import PipelineEngine


def _run(raw_modules: list[dict], seed: int = 0):
    """Invoke PipelineEngine directly against plain dict snapshots.

    `module_from_dict` only deserialises fixed_values into a dataclass;
    PipelineEngine's loop accepts dicts via `coerce_legacy_module` for
    every other kind. Passing dicts uniformly keeps the test fixtures
    declarative without per-kind helpers."""
    return PipelineEngine().run(raw_modules, seed=seed)


# ── 1. combine reads upstream sibling writes (the canonical happy path) ─

def test_combine_consumes_upstream_sibling_writes():
    """fixed_values → combine. Combine reads $subject + $style from siblings,
    emits ONLY $caption. Engine never adds $subject/$style as combine writes."""
    ctx = _run([
        {
            "id": "fv01",
            "type": "fixed_values",
            "entries": [
                {"variable_name": "subject", "value": "knight"},
                {"variable_name": "style", "value": "photoreal"},
            ],
        },
        {
            "id": "cb01",
            "type": "combine",
            "payload": {
                "template": "A $style painting of a $subject",
                "output_var": "caption",
            },
        },
    ])

    user = strip_internals(ctx)
    assert user == {
        "subject": "knight",
        "style": "photoreal",
        "caption": "A photoreal painting of a knight",
    }
    # Combine must NOT have leaked input names as its own writes —
    # only `caption` is in the trace's combine writes. Trace entries
    # carry full dicts (variable / value / source / overwrite); just
    # project to variable names for the assertion.
    combine_trace = next(t for t in ctx["__wp_trace__"] if t["id"] == "cb01")
    written_names = [w["variable"] for w in combine_trace["writes"]]
    assert written_names == ["caption"]


# ── 2. combine references a missing var → `$missing` collapses to empty + warns ─

def test_combine_missing_var_emits_unknown_var_warning():
    """Phase 5.5.6 added a runtime `unknown_var` warning so the user gets a
    signal when a combine template references a var nothing upstream
    provides. The missing var still collapses silently to empty in the
    output string (lenient surface), but the warning is now visible."""
    ctx = _run([
        {
            "id": "fv01",
            "type": "fixed_values",
            "entries": [{"variable_name": "subject", "value": "knight"}],
        },
        {
            "id": "cb01",
            "type": "combine",
            "payload": {
                "template": "$subject in $place",   # $place never bound
                "output_var": "out",
            },
        },
    ])

    user = strip_internals(ctx)
    assert user["out"] == "knight in "      # missing var → empty

    unknown = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_var"]
    assert len(unknown) == 1
    assert unknown[0]["detail"]["name"] == "place"
    assert unknown[0]["detail"]["surface"] == "combine"


# ── 3. derivation condition + action.value templating ─

def test_derivation_condition_matches_then_template_resolves():
    """Derivation reads $age via condition, fires the matching branch, and
    resolves $name inside its action.value template. Validates both:
    (a) condition.var read works against an upstream-provided var, and
    (b) action.value passes through resolve_text under the `derivation`
        surface so $var tokens substitute."""
    ctx = _run([
        {
            "id": "fv01",
            "type": "fixed_values",
            "entries": [
                {"variable_name": "age", "value": "30"},
                {"variable_name": "name", "value": "Alice"},
            ],
        },
        {
            "id": "dv01",
            "type": "derivation",
            "payload": {
                "rules": [{
                    "id": "r0",
                    "branches": [{
                        "condition": {"var": "age", "op": "equals", "value": "30"},
                        "action": {
                            "target_var": "greeting",
                            "mode": "replace",
                            "value": "hello $name",
                        },
                    }],
                    "else": {"action": {
                        "target_var": "greeting",
                        "mode": "replace",
                        "value": "hi stranger",
                    }},
                }],
            },
        },
    ])

    user = strip_internals(ctx)
    assert user["greeting"] == "hello Alice"


def test_derivation_else_fires_when_condition_var_missing():
    """If condition.var isn't bound upstream, runtime _ctx_get returns "",
    so any equals comparison against a non-empty value fails → else fires.
    Demonstrates that the static `missing_template_variable` warning is
    informative, not blocking — engine still produces output."""
    ctx = _run([
        # No upstream $age — condition will silently miss.
        {
            "id": "dv01",
            "type": "derivation",
            "payload": {
                "rules": [{
                    "id": "r0",
                    "branches": [{
                        "condition": {"var": "age", "op": "equals", "value": "30"},
                        "action": {
                            "target_var": "mood",
                            "mode": "replace",
                            "value": "calm",
                        },
                    }],
                    "else": {"action": {
                        "target_var": "mood",
                        "mode": "replace",
                        "value": "fallback",
                    }},
                }],
            },
        },
    ])

    user = strip_internals(ctx)
    assert user["mood"] == "fallback"


def test_derivation_action_value_template_with_missing_var_warns():
    """action.value goes through resolve_text under derivation surface,
    so an unbound $var inside it triggers an `unknown_var` warning AND
    collapses to empty in the output — same lenient behaviour as combine."""
    ctx = _run([
        {
            "id": "dv01",
            "type": "derivation",
            "payload": {
                "rules": [{
                    "id": "r0",
                    "branches": [{
                        "condition": {"var": "age", "op": "not_equals", "value": "ignored"},
                        "action": {
                            "target_var": "tag",
                            "mode": "replace",
                            "value": "uses $unbound",
                        },
                    }],
                }],
            },
        },
    ])

    user = strip_internals(ctx)
    # `_ctx_get(ctx, "age")` → "" → `"" != "ignored"` → True → branch fires.
    assert user["tag"] == "uses "

    unknown = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_var"]
    assert any(w["detail"]["name"] == "unbound" for w in unknown)
    assert all(w["detail"]["surface"] == "derivation" for w in unknown)


# ── 4. mixed-kind chain: fixed_values + combine + derivation pipeline ─

def test_full_chain_fixed_values_combine_derivation():
    """End-to-end: fixed_values seeds vars → combine builds a phrase →
    derivation rewrites a final caption. Mirrors a realistic canvas config
    where each kind contributes a distinct slice of the pipeline."""
    ctx = _run([
        {
            "id": "fv01",
            "type": "fixed_values",
            "entries": [
                {"variable_name": "subject", "value": "knight"},
                {"variable_name": "tone", "value": "noir"},
                {"variable_name": "mood", "value": "stoic"},
            ],
        },
        {
            "id": "cb01",
            "type": "combine",
            "payload": {
                "template": "$tone $subject",
                "output_var": "phrase",
            },
        },
        {
            "id": "dv01",
            "type": "derivation",
            "payload": {
                "rules": [{
                    "id": "r0",
                    "branches": [{
                        "condition": {"var": "mood", "op": "equals", "value": "stoic"},
                        "action": {
                            "target_var": "caption",
                            "mode": "replace",
                            "value": "[$phrase, calm]",
                        },
                    }],
                    "else": {"action": {
                        "target_var": "caption",
                        "mode": "replace",
                        "value": "[$phrase, ???]",
                    }},
                }],
            },
        },
    ])

    user = strip_internals(ctx)
    assert user["phrase"] == "noir knight"
    assert user["caption"] == "[noir knight, calm]"

    # Trace records all three modules in order, no errors.
    trace_ids = [t["id"] for t in ctx["__wp_trace__"] if t.get("status") != "skipped_disabled"]
    assert trace_ids == ["fv01", "cb01", "dv01"]
    assert all(t.get("error") is None for t in ctx["__wp_trace__"])

    # No spurious unknown_var warnings — every $var is bound by the
    # time it's read.
    unknown = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_var"]
    assert unknown == []


def test_disabled_module_skipped_in_chain():
    """Disabled modules must not contribute writes OR warnings — the
    static scanner respects this too (combine.test asserts the
    parallel UI behaviour)."""
    ctx = _run([
        {
            "id": "fv01",
            "type": "fixed_values",
            "entries": [{"variable_name": "subject", "value": "knight"}],
        },
        {
            "id": "cb01",
            "type": "combine",
            "enabled": False,                     # ← disabled
            "payload": {
                "template": "$subject and $missing",
                "output_var": "out",
            },
        },
    ])

    user = strip_internals(ctx)
    assert "out" not in user                      # combine never ran
    unknown = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_var"]
    assert unknown == []                          # no warning for disabled
