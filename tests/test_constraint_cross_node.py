"""Constraint × wildcard ACROSS WP_Context node boundaries.

Pre-fix: `__wp_picks__` and `__wp_constraints__` got dropped at the
PIPELINE_CONTEXT socket boundary because `strip_internals` ate every
`__`-prefixed key. A 3-node chain like

    Context A: hair wildcard (records hair pick)
    Context B: hair_x_mood constraint (registers in ctx)
    Context C: mood wildcard (reads constraints + source pick)

silently failed: hair's pick never reached B's ctx, B's constraint
never reached C's ctx, C's mood wildcard ran unconstrained. User QA
caught this with a real workflow that produced "long hair → negative
mood" despite a `long → exclude negative` constraint.

Fix: ContextPayload carries an `internals` field with the cross-node
subset (`__wp_picks__` + `__wp_constraints__`). WP_Context.execute
merges that field back into ctx before running its own pipeline.
"""
from __future__ import annotations

import json

from wp_nodes.context_node import WPContext
from wp_nodes.types import ContextPayload


def _modules_json(modules: list[dict]) -> str:
    return json.dumps({"version": 1, "modules": modules})


def _hair_module() -> dict:
    return {
        "id": "ae07018b",
        "type": "wildcard",
        "enabled": True,
        "payload": {
            "var_binding": "hair_style",
            "options": [
                {"id": "h1", "value": "long flowing", "weight": 1, "sub_categories": ["long"]},
            ],
        },
        "instance": {},
    }


def _mood_module() -> dict:
    return {
        "id": "c14e7527",
        "type": "wildcard",
        "enabled": True,
        "payload": {
            "var_binding": "mood",
            "options": [
                {"id": "m1", "value": "joyful",      "weight": 1, "sub_categories": ["positive"]},
                {"id": "m2", "value": "melancholic", "weight": 1, "sub_categories": ["negative"]},
            ],
        },
        "instance": {},
    }


def _hair_x_mood_constraint() -> dict:
    """`long → exclude negative`, `short → exclude positive`. Mirrors
    the QA-reported scenario."""
    return {
        "id": "e41f5bc4",
        "type": "constraint",
        "enabled": True,
        "payload": {
            "source_wildcard_id": "ae07018b",
            "target_wildcard_id": "c14e7527",
            "matrix": {
                "long":  {"negative": {"mode": "exclude", "factor": 1}},
                "short": {"positive": {"mode": "exclude", "factor": 1}},
            },
            "exceptions": [],
        },
        "instance": {},
    }


def test_picks_carried_via_internals_field():
    """Sanity: a Context node running a wildcard emits its pick in the
    payload's `internals.__wp_picks__` field. Pre-fix this lived only
    inside the run's transient ctx and never crossed the socket."""
    out = WPContext.execute(
        seed=0,
        wp_modules=_modules_json([_hair_module()]),
        upstream=None,
    )
    payload: ContextPayload = out.values[0]
    picks = payload.internals.get("__wp_picks__")
    assert isinstance(picks, dict)
    assert "ae07018b" in picks
    assert picks["ae07018b"]["sub_categories"] == ["long"]
    # User-facing context stays free of the bookkeeping bucket.
    assert "__wp_picks__" not in payload.context


def test_constraints_carried_via_internals_field():
    """Same contract for constraint metadata — registers via the
    handler, surfaces on the next-node-visible internals field."""
    out = WPContext.execute(
        seed=0,
        wp_modules=_modules_json([_hair_x_mood_constraint()]),
        upstream=None,
    )
    payload: ContextPayload = out.values[0]
    constraints = payload.internals.get("__wp_constraints__")
    assert isinstance(constraints, list)
    assert len(constraints) == 1
    assert constraints[0]["target_wildcard_id"] == "c14e7527"
    assert "_constraints" not in payload.context
    assert "__wp_constraints__" not in payload.context


def test_three_node_chain_constraint_actually_constrains_target():
    """The QA scenario end-to-end: hair in A → constraint in B → mood
    in C. The constraint must reach C's ctx and exclude `negative`
    when hair picked `long`. Pre-fix: long hair + ANY mood. Post-fix:
    long hair + ONLY positive mood across every seed."""
    # Run Context A — hair picks "long flowing" (sub_category "long").
    a_out = WPContext.execute(
        seed=1,
        wp_modules=_modules_json([_hair_module()]),
        upstream=None,
    )
    a_payload: ContextPayload = a_out.values[0]
    assert a_payload.context["hair_style"] == "long flowing"

    # Run Context B with A as upstream — constraint registers.
    b_out = WPContext.execute(
        seed=2,
        wp_modules=_modules_json([_hair_x_mood_constraint()]),
        upstream=a_payload,
    )
    b_payload: ContextPayload = b_out.values[0]
    # Hair_style still flowing through (A's user-facing var preserved).
    assert b_payload.context["hair_style"] == "long flowing"
    # Constraint registered in internals.
    assert len(b_payload.internals["__wp_constraints__"]) == 1
    # And the original pick is still in internals (carried forward).
    assert "ae07018b" in b_payload.internals["__wp_picks__"]

    # Run Context C with B as upstream — mood picks; must avoid `negative`.
    # Try several seeds to make sure it's not seed luck.
    for seed in range(20):
        c_out = WPContext.execute(
            seed=seed,
            wp_modules=_modules_json([_mood_module()]),
            upstream=b_payload,
        )
        c_payload: ContextPayload = c_out.values[0]
        assert c_payload.context["mood"] == "joyful", (
            f"seed {seed}: long hair should exclude negative mood, "
            f"got {c_payload.context['mood']!r}"
        )


def test_three_node_chain_short_hair_excludes_positive_mood():
    """Symmetric case — short source picks the OTHER half of the
    matrix. Pin both directions so the test catches a one-sided bug
    (e.g. only the first matrix row applied)."""
    short_hair = _hair_module()
    short_hair["payload"]["options"] = [
        {"id": "h2", "value": "buzz cut", "weight": 1, "sub_categories": ["short"]},
    ]
    a_out = WPContext.execute(
        seed=1, wp_modules=_modules_json([short_hair]), upstream=None,
    )
    b_out = WPContext.execute(
        seed=2,
        wp_modules=_modules_json([_hair_x_mood_constraint()]),
        upstream=a_out.values[0],
    )
    for seed in range(20):
        c_out = WPContext.execute(
            seed=seed,
            wp_modules=_modules_json([_mood_module()]),
            upstream=b_out.values[0],
        )
        c_payload: ContextPayload = c_out.values[0]
        assert c_payload.context["mood"] == "melancholic", (
            f"seed {seed}: short hair should exclude positive mood, "
            f"got {c_payload.context['mood']!r}"
        )
