"""Constraint × wildcard end-to-end via PipelineEngine.

Constraint module records metadata in `ctx["__wp_constraints__"]`. A
downstream wildcard whose id matches a constraint's `target_wildcard_id`
applies the matrix + exceptions to its option pool before picking.
The source wildcard MUST run before the target — pipeline order is
load-bearing — so each test fixes the chain layout explicitly.
"""
from __future__ import annotations

from engine.context import strip_internals
from engine.pipeline import PipelineEngine


def _wildcard(uuid: str, var_binding: str, options: list[dict]) -> dict:
    """Plain dict snapshot for a wildcard. Pipeline accepts dicts via
    coerce_legacy_module for non-fixed_values kinds."""
    return {
        "id": uuid,
        "type": "wildcard",
        "enabled": True,
        "payload": {"var_binding": var_binding, "options": options},
        "instance": {},
    }


def _constraint(
    source_uuid: str,
    target_uuid: str,
    matrix: dict,
    exceptions: list[dict] | None = None,
) -> dict:
    return {
        "id": f"c_{source_uuid[:4]}_{target_uuid[:4]}",
        "type": "constraint",
        "enabled": True,
        "payload": {
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": target_uuid,
            "matrix": matrix,
            "exceptions": exceptions or [],
        },
        "instance": {},
    }


def _run(modules: list[dict], seed: int = 0):
    return PipelineEngine().run(modules, seed=seed)


# ── Pick tracking — ground truth for constraint application ──────────

def test_wildcard_pick_recorded_in_ctx_picks():
    """Every wildcard pick should land in `ctx["__wp_picks__"]` keyed by
    module id, so downstream constraint-aware wildcards can read it.
    Pin the contract — without it, constraint integration has no signal
    to act on."""
    ctx = _run([
        _wildcard("aaaa1111", "hair", [
            {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
        ]),
    ])
    picks = ctx.get("__wp_picks__")
    assert isinstance(picks, dict)
    assert "aaaa1111" in picks
    assert picks["aaaa1111"]["value"] == "long"
    assert picks["aaaa1111"]["sub_categories"] == ["long"]


# ── Matrix application — sub_category × sub_category bulk rule ───────

def test_constraint_matrix_excludes_target_options_by_subcategory():
    """Source picks "long" → matrix["long"]["formal"] = exclude. Target
    options whose sub_category is "formal" should drop out of the pool.
    Other sub_categories pass through with weights intact."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
        {"id": "o2", "value": "tshirt", "weight": 1, "sub_categories": ["casual"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
    )
    # Run a handful of seeds — `formal` should NEVER be picked.
    for seed in range(20):
        ctx = _run([src, constraint, target], seed=seed)
        assert strip_internals(ctx)["outfit"] == "tshirt"


def test_constraint_matrix_boosts_target_subcategory():
    """Boost factor multiplies the matched options' weight. With a 100x
    boost on "casual" and equal library weights, "casual" should
    dominate picks across many seeds."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "short", "weight": 1, "sub_categories": ["short"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "suit", "weight": 1, "sub_categories": ["formal"]},
        {"id": "o2", "value": "tshirt", "weight": 1, "sub_categories": ["casual"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"short": {"casual": {"mode": "boost", "factor": 100}}},
    )
    casual_picks = 0
    for seed in range(40):
        ctx = _run([src, constraint, target], seed=seed)
        if strip_internals(ctx)["outfit"] == "tshirt":
            casual_picks += 1
    # With 100x boost vs 1x, expect overwhelming dominance.
    assert casual_picks >= 35, f"only {casual_picks}/40 casual picks"


# ── Exception application — value × value narrow override ────────────

def test_constraint_exception_excludes_specific_value_pair():
    """Matrix says everything is allowed; exception says
    "long" + "kimono" → exclude. Kimono drops out specifically when
    source picked long. Plain matrix "long" → "formal" allow stays
    intact for non-kimono formal options."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
        {"id": "o2", "value": "suit", "weight": 1, "sub_categories": ["formal"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "allow", "factor": 1}}},
        exceptions=[
            {"source": "long", "target": "kimono", "mode": "exclude", "factor": 1},
        ],
    )
    for seed in range(20):
        ctx = _run([src, constraint, target], seed=seed)
        assert strip_internals(ctx)["outfit"] == "suit"


def test_constraint_exception_overrides_matrix_when_both_apply():
    """If matrix excludes a sub_category but an exception explicitly
    boosts a value within that sub_category, the exception wins
    (narrower-rule precedence)."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
        exceptions=[
            {"source": "long", "target": "kimono", "mode": "allow", "factor": 1},
        ],
    )
    ctx = _run([src, constraint, target], seed=0)
    # Only one option, exception allowed it, so it picks.
    assert strip_internals(ctx)["outfit"] == "kimono"


# ── Wrong order — source after target — must warn, not crash ─────────

def test_constraint_with_unpicked_source_emits_warning():
    """Constraint targeting a wildcard whose source hasn't been
    resolved yet (bad chain order) should NOT crash. Wildcard skips
    the constraint, picks normally, and the engine emits an
    `unknown_constraint_source` warning so the user gets a signal."""
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "suit", "weight": 1, "sub_categories": ["formal"]},
    ])
    # Note source wildcard NOT included — constraint references a
    # source that never runs.
    constraint = _constraint(
        "aaaa9999", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
    )
    ctx = _run([constraint, target], seed=0)
    assert strip_internals(ctx)["outfit"] == "suit"
    warnings = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_constraint_source"]
    assert len(warnings) == 1
    assert warnings[0]["detail"]["source_wildcard_id"] == "aaaa9999"


# ── No constraints at all — default path unchanged ───────────────────

def test_factor_ignored_on_allow_emits_warning():
    """`mode: allow` with a non-1 factor is a SPA-editor footgun —
    user expects weight × factor, engine semantics ignore the factor
    entirely. Surface a warning so the discrepancy is visible."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "allow", "factor": 0.5}}},
    )
    ctx = _run([src, constraint, target], seed=0)
    warnings = [
        w for w in ctx["__wp_warnings__"]
        if w["type"] == "constraint_factor_ignored_on_allow"
    ]
    assert len(warnings) == 1
    assert warnings[0]["detail"]["factor"] == 0.5


def test_constraint_excludes_all_options_emits_warning():
    """When matrix excludes every option in the target's pool, total
    weight collapses to 0 and `_pick_weighted` falls back to options[0]
    silently. Surface `constraint_excludes_all_options` so the user
    sees the over-narrowed pool instead of debugging "why does this
    always pick the first option" blind."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "a", "weight": 1, "sub_categories": ["formal"]},
        {"id": "o2", "value": "b", "weight": 1, "sub_categories": ["formal"]},
    ])
    constraint = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
    )
    ctx = _run([src, constraint, target], seed=0)
    warnings = [w for w in ctx["__wp_warnings__"] if w["type"] == "constraint_excludes_all_options"]
    assert len(warnings) == 1


def test_wildcard_runs_unchanged_when_no_constraints_present():
    """Sanity check: a chain without any constraints behaves exactly
    like pre-integration. Pin so future refactors of the constraint
    branch don't accidentally alter the default pick path."""
    target = _wildcard("bbbb2222", "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
    ])
    ctx = _run([target], seed=0)
    assert strip_internals(ctx)["outfit"] == "kimono"
    assert ctx["__wp_picks__"]["bbbb2222"]["value"] == "kimono"
