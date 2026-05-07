"""Tests for ConstraintHandler — pass-through stub that records metadata."""
import json

import pytest

from engine.modules.constraint_handler import ConstraintHandler


def _payload():
    return {
        "source_wildcard_id": "wc_outfit",
        "target_wildcard_id": "wc_pose",
        "matrix": {
            "kimono": {"casual": {"mode": "exclude", "factor": 1.0}},
        },
        "exceptions": [],
    }


def test_handler_type_id_is_constraint():
    assert ConstraintHandler.type_id == "constraint"


def test_validate_payload_accepts_well_formed():
    ConstraintHandler.validate_payload(_payload())


def test_validate_payload_rejects_blank_source_id():
    payload = _payload()
    payload["source_wildcard_id"] = ""
    with pytest.raises(ValueError, match="source_wildcard_id"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_unknown_mode():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["mode"] = "weird"
    with pytest.raises(ValueError, match="mode"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_accepts_zero_factor():
    """factor=0 is canonical for "exclude this pair" — both `mode: exclude`
    and a zero factor encode the same intent. Strict > 0 was rejecting
    legitimate SPA-saved payloads where the editor surfaced an explicit
    zero weight (a real QA-reported regression). Negative factors stay
    rejected — they have no defined semantics in the weighted-pick
    model."""
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = 0.0
    ConstraintHandler.validate_payload(payload)  # must not raise


def test_validate_payload_rejects_negative_factor():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = -1.0
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_non_numeric_factor():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = "1.0"
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_bool_factor():
    """``True`` is technically an int, but a bool factor is meaningless here."""
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = True
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_accepts_exceptions():
    payload = _payload()
    payload["exceptions"] = [
        {"source": "kimono", "target": "casual", "mode": "boost", "factor": 1.5},
    ]
    ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_exception_with_bad_mode():
    payload = _payload()
    payload["exceptions"] = [
        {"source": "kimono", "target": "casual", "mode": "huh", "factor": 1.0},
    ]
    with pytest.raises(ValueError, match="mode"):
        ConstraintHandler.validate_payload(payload)


def test_resolve_records_metadata_into_ctx_constraints_list():
    ctx: dict = {}
    out = ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    # Pass-through stub returns no bindings; mutates ctx instead.
    assert out == {}
    assert isinstance(ctx["__wp_constraints__"], list)
    assert len(ctx["__wp_constraints__"]) == 1
    meta = ctx["__wp_constraints__"][0]
    assert meta["source_wildcard_id"] == "wc_outfit"
    assert meta["target_wildcard_id"] == "wc_pose"
    assert meta["matrix"] == {"kimono": {"casual": {"mode": "exclude", "factor": 1.0}}}
    assert meta["exceptions"] == []


def test_resolve_appends_to_existing_constraints():
    ctx: dict = {"__wp_constraints__": [{"source_wildcard_id": "earlier"}]}
    ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    assert len(ctx["__wp_constraints__"]) == 2
    assert ctx["__wp_constraints__"][0]["source_wildcard_id"] == "earlier"
    assert ctx["__wp_constraints__"][1]["source_wildcard_id"] == "wc_outfit"


def test_resolve_rejects_malformed_payload():
    with pytest.raises(ValueError):
        ConstraintHandler.resolve(
            {"source_wildcard_id": "", "target_wildcard_id": "x", "matrix": {}},
            instance={},
            ctx={},
        )


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    ctx: dict = {}
    snap = {"type": "constraint", "payload": _payload(), "instance": {}}
    out = resolve_module(snap, ctx=ctx)
    assert out == {}
    assert len(ctx["__wp_constraints__"]) == 1


def test_constraint_bucket_does_not_leak_to_public_socket():
    """`strip_internals` must drop the `__wp_constraints__` bucket so the
    assembler / downstream user-facing payload never sees it as a
    spurious `_constraints` variable. Regression: pre-rename the bucket
    used a single-underscore key that bypassed the strip filter, so
    autocomplete in the assembler showed `$_constraints` as a pickable
    var even though no module had bound it."""
    from engine.context import strip_internals

    ctx: dict = {}
    ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    # Internal bucket lives in ctx during the run.
    assert "__wp_constraints__" in ctx
    # Public socket strip drops it — no `_constraints`, no
    # `__wp_constraints__`, nothing constraint-flavoured surfaces.
    public = strip_internals(ctx)
    assert "_constraints" not in public
    assert "__wp_constraints__" not in public


def _instance(**kwargs):
    """Fresh instance dict with explicit overrides."""
    base = {
        "disabled_rule_ids": None,
        "disabled_exception_keys": None,
        "disabled_matrix_cells": None,
    }
    base.update(kwargs)
    return base


def test_constraint_resolve_disabled_matrix_cells_excluded_from_ctx():
    payload = {
        "source_wildcard_id": "src-uuid",
        "target_wildcard_id": "tgt-uuid",
        "matrix": {
            "s1": {"t1": {"mode": "allow", "factor": 1}, "t2": {"mode": "exclude", "factor": 0}},
        },
        "exceptions": [],
    }
    instance = _instance(disabled_matrix_cells=[json.dumps(["s1", "t1"], separators=(",", ":"))])
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, instance, ctx)
    matrix = ctx["__wp_constraints__"][0]["matrix"]
    assert "t1" not in matrix.get("s1", {})
    assert "t2" in matrix.get("s1", {})


def test_constraint_resolve_disabled_exception_keys_excluded():
    payload = {
        "source_wildcard_id": "src-uuid",
        "target_wildcard_id": "tgt-uuid",
        "matrix": {},
        "exceptions": [
            {"source_value": "red", "target_value": "blue", "mode": "allow", "factor": 1},
            {"source_value": "x", "target_value": "y", "mode": "allow", "factor": 1},
        ],
    }
    instance = _instance(
        disabled_exception_keys=[json.dumps(["red", "blue"], separators=(",", ":"))]
    )
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, instance, ctx)
    excs = ctx["__wp_constraints__"][0]["exceptions"]
    assert len(excs) == 1
    assert excs[0]["source_value"] == "x"


def test_constraint_resolve_empty_disable_lists_unchanged_output():
    payload = {
        "source_wildcard_id": "src",
        "target_wildcard_id": "tgt",
        "matrix": {"s": {"t": {"mode": "allow", "factor": 1}}},
        "exceptions": [{"source_value": "a", "target_value": "b", "mode": "allow", "factor": 1}],
    }
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, _instance(), ctx)
    meta = ctx["__wp_constraints__"][0]
    assert meta["matrix"] == payload["matrix"]
    assert meta["exceptions"] == payload["exceptions"]
