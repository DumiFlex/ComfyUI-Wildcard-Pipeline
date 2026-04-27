"""Tests for DerivationHandler — IF/ELIF/ELSE rules over runtime context."""
import pytest

from engine.modules.derivation_handler import DerivationHandler


def _rule(rid="r1", branches=None, else_clause=None):
    out = {"id": rid, "branches": branches or []}
    if else_clause is not None:
        out["else"] = else_clause
    return out


def test_handler_type_id_is_derivation():
    assert DerivationHandler.type_id == "derivation"


def test_validate_payload_accepts_well_formed():
    DerivationHandler.validate_payload({
        "rules": [
            _rule(branches=[{
                "condition": {"var": "x", "op": "equals", "value": "a"},
                "action": {"target_var": "y", "mode": "replace", "value": "b"},
            }]),
        ],
    })


def test_validate_payload_rejects_non_list_rules():
    with pytest.raises(ValueError, match="rules"):
        DerivationHandler.validate_payload({"rules": "nope"})


def test_validate_payload_rejects_empty_branches():
    with pytest.raises(ValueError, match="branches"):
        DerivationHandler.validate_payload({"rules": [_rule(branches=[])]})


def test_validate_payload_rejects_unknown_op():
    with pytest.raises(ValueError, match="op"):
        DerivationHandler.validate_payload({"rules": [_rule(branches=[{
            "condition": {"var": "x", "op": "weird", "value": "a"},
            "action": {"target_var": "y", "mode": "replace", "value": "b"},
        }])]})


def test_validate_payload_rejects_unknown_mode():
    with pytest.raises(ValueError, match="mode"):
        DerivationHandler.validate_payload({"rules": [_rule(branches=[{
            "condition": {"var": "x", "op": "equals", "value": "a"},
            "action": {"target_var": "y", "mode": "frob", "value": "b"},
        }])]})


def test_resolve_first_matching_branch_wins():
    ctx: dict = {"mood": "happy"}
    payload = {"rules": [_rule(branches=[
        {
            "condition": {"var": "mood", "op": "equals", "value": "sad"},
            "action": {"target_var": "tone", "mode": "replace", "value": "blue"},
        },
        {
            "condition": {"var": "mood", "op": "equals", "value": "happy"},
            "action": {"target_var": "tone", "mode": "replace", "value": "bright"},
        },
    ])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"tone": "bright"}
    assert ctx["tone"] == "bright"


def test_resolve_else_fires_when_nothing_matches():
    ctx: dict = {"mood": "neutral"}
    payload = {"rules": [_rule(
        branches=[{
            "condition": {"var": "mood", "op": "equals", "value": "happy"},
            "action": {"target_var": "tone", "mode": "replace", "value": "bright"},
        }],
        else_clause={
            "action": {"target_var": "tone", "mode": "replace", "value": "muted"},
        },
    )]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"tone": "muted"}


def test_resolve_no_match_no_else_is_noop():
    ctx: dict = {"mood": "neutral"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "mood", "op": "equals", "value": "happy"},
        "action": {"target_var": "tone", "mode": "replace", "value": "bright"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {}
    assert "tone" not in ctx


def test_resolve_append_mode_concatenates():
    ctx: dict = {"x": "value", "buf": "start-"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "x", "op": "equals", "value": "value"},
        "action": {"target_var": "buf", "mode": "append", "value": "end"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"buf": "start-end"}


def test_resolve_prepend_mode_concatenates():
    ctx: dict = {"x": "yes", "buf": "world"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "x", "op": "equals", "value": "yes"},
        "action": {"target_var": "buf", "mode": "prepend", "value": "hello-"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"buf": "hello-world"}


def test_resolve_contains_op():
    ctx: dict = {"text": "the quick brown fox"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "text", "op": "contains", "value": "brown"},
        "action": {"target_var": "found", "mode": "replace", "value": "yes"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"found": "yes"}


def test_resolve_matches_op_uses_regex():
    ctx: dict = {"name": "user_42"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "name", "op": "matches", "value": r"^user_\d+$"},
        "action": {"target_var": "kind", "mode": "replace", "value": "user"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"kind": "user"}


def test_resolve_not_equals_op():
    ctx: dict = {"role": "admin"}
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "role", "op": "not_equals", "value": "guest"},
        "action": {"target_var": "level", "mode": "replace", "value": "high"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"level": "high"}


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    snap = {
        "type": "derivation",
        "payload": {"rules": [_rule(branches=[{
            "condition": {"var": "a", "op": "equals", "value": "1"},
            "action": {"target_var": "b", "mode": "replace", "value": "2"},
        }])]},
        "instance": {},
    }
    out = resolve_module(snap, ctx={"a": "1"})
    assert out == {"b": "2"}
