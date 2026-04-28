"""Tests for ConstraintHandler — pass-through stub that records metadata."""
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


def test_validate_payload_rejects_zero_factor():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = 0.0
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


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
    assert isinstance(ctx["_constraints"], list)
    assert len(ctx["_constraints"]) == 1
    meta = ctx["_constraints"][0]
    assert meta["source_wildcard_id"] == "wc_outfit"
    assert meta["target_wildcard_id"] == "wc_pose"
    assert meta["matrix"] == {"kimono": {"casual": {"mode": "exclude", "factor": 1.0}}}
    assert meta["exceptions"] == []


def test_resolve_appends_to_existing_constraints():
    ctx: dict = {"_constraints": [{"source_wildcard_id": "earlier"}]}
    ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    assert len(ctx["_constraints"]) == 2
    assert ctx["_constraints"][0]["source_wildcard_id"] == "earlier"
    assert ctx["_constraints"][1]["source_wildcard_id"] == "wc_outfit"


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
    assert len(ctx["_constraints"]) == 1
