"""Tests for DerivationHandler — IF/ELIF/ELSE rules over runtime context."""
import random

import pytest

from engine.modules.derivation_handler import DerivationHandler


def _rule(rid="r1", branches=None, else_clause=None):
    out = {"id": rid, "branches": branches or []}
    if else_clause is not None:
        out["else"] = else_clause
    return out


def _ctx(**extra):
    """Return a minimal valid runtime ctx dict with rng + warnings."""
    return {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        **extra,
    }


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
    ctx = _ctx(mood="happy")
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
    ctx = _ctx(mood="neutral")
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
    ctx = _ctx(mood="neutral")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "mood", "op": "equals", "value": "happy"},
        "action": {"target_var": "tone", "mode": "replace", "value": "bright"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {}
    assert "tone" not in ctx


def test_resolve_append_mode_concatenates():
    ctx = _ctx(x="value", buf="start-")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "x", "op": "equals", "value": "value"},
        "action": {"target_var": "buf", "mode": "append", "value": "end"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"buf": "start-end"}


def test_resolve_prepend_mode_concatenates():
    ctx = _ctx(x="yes", buf="world")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "x", "op": "equals", "value": "yes"},
        "action": {"target_var": "buf", "mode": "prepend", "value": "hello-"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"buf": "hello-world"}


def test_resolve_contains_op():
    ctx = _ctx(text="the quick brown fox")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "text", "op": "contains", "value": "brown"},
        "action": {"target_var": "found", "mode": "replace", "value": "yes"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"found": "yes"}


def test_resolve_matches_op_uses_regex():
    ctx = _ctx(name="user_42")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "name", "op": "matches", "value": r"^user_\d+$"},
        "action": {"target_var": "kind", "mode": "replace", "value": "user"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"kind": "user"}


def test_resolve_not_equals_op():
    ctx = _ctx(role="admin")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "role", "op": "not_equals", "value": "guest"},
        "action": {"target_var": "level", "mode": "replace", "value": "high"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"level": "high"}


def test_resolve_action_value_supports_var_interpolation():
    """Action value is resolved through resolve_text; $var tokens are substituted."""
    ctx = _ctx(mood="warm", base_color="orange")
    payload = {"rules": [_rule(branches=[{
        "condition": {"var": "mood", "op": "equals", "value": "warm"},
        "action": {"target_var": "tone", "mode": "replace", "value": "$base_color glow"},
    }])]}
    out = DerivationHandler.resolve(payload, instance={}, ctx=ctx)
    assert out == {"tone": "orange glow"}


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
    ctx = _ctx(a="1")
    out = resolve_module(snap, ctx=ctx)
    assert out == {"b": "2"}


def test_derivation_skips_rules_in_disabled_rule_ids():
    payload = {
        "rules": [
            {
                "id": "r1",
                "branches": [{
                    "condition": {"var": "x", "op": "equals", "value": "1"},
                    "action": {"target_var": "out", "mode": "replace", "value": "from-r1"},
                }],
            },
            {
                "id": "r2",
                "branches": [{
                    "condition": {"var": "x", "op": "equals", "value": "1"},
                    "action": {"target_var": "out", "mode": "replace", "value": "from-r2"},
                }],
            },
        ],
    }
    instance = {"disabled_rule_ids": ["r1"]}
    ctx = _ctx(x="1")
    out = DerivationHandler.resolve(payload, instance, ctx)
    # r1 is skipped, r2 matches and wins
    assert out.get("out") == "from-r2"


def test_derivation_empty_disabled_list_processes_all_rules():
    payload = {
        "rules": [
            {
                "id": "r1",
                "branches": [{
                    "condition": {"var": "x", "op": "equals", "value": "1"},
                    "action": {"target_var": "out", "mode": "replace", "value": "matched"},
                }],
            },
        ],
    }
    ctx = _ctx(x="1")
    out = DerivationHandler.resolve(payload, {"disabled_rule_ids": None}, ctx)
    # empty/None disabled list means all rules process
    assert out.get("out") == "matched"


def test_derivation_disabled_id_not_in_payload_is_noop():
    payload = {
        "rules": [
            {
                "id": "r1",
                "branches": [{
                    "condition": {"var": "x", "op": "equals", "value": "1"},
                    "action": {"target_var": "out", "mode": "replace", "value": "matched"},
                }],
            },
        ],
    }
    ctx = _ctx(x="1")
    out = DerivationHandler.resolve(payload, {"disabled_rule_ids": ["nonexistent"]}, ctx)
    # nonexistent rule id in disabled list doesn't affect r1, so r1 still matches
    assert out.get("out") == "matched"


# ── Presence-check ops (2026-05-09 cycle) ───────────────────────────────
# `exists`/`not_exists` check key presence in ctx (regardless of value);
# `is_set`/`is_unset` check both presence AND non-empty value. Both pairs
# ship so users can pick the semantics they need — a wildcard that picked
# an empty option still has its key set in ctx.

def _presence_payload(op: str, target_value: str = "yes") -> dict:
    """Build a single-rule payload that fires when the presence op matches."""
    return {"rules": [_rule(branches=[{
        "condition": {"var": "x", "op": op, "value": ""},
        "action": {"target_var": "out", "mode": "replace", "value": target_value},
    }])]}


def test_resolve_exists_op_fires_when_key_present_with_value():
    ctx = _ctx(x="anything")
    out = DerivationHandler.resolve(_presence_payload("exists"), instance={}, ctx=ctx)
    assert out.get("out") == "yes"


def test_resolve_exists_op_fires_when_key_present_with_empty_value():
    """Wildcards that pick an option with empty value still set the key —
    `exists` semantically means "key is in ctx", so it must fire here."""
    ctx = _ctx(x="")
    out = DerivationHandler.resolve(_presence_payload("exists"), instance={}, ctx=ctx)
    assert out.get("out") == "yes"


def test_resolve_exists_op_does_not_fire_when_key_absent():
    ctx = _ctx()  # no x
    out = DerivationHandler.resolve(_presence_payload("exists"), instance={}, ctx=ctx)
    assert "out" not in out


def test_resolve_not_exists_op_inverse_of_exists():
    # Absent → fires
    ctx_absent = _ctx()
    out_absent = DerivationHandler.resolve(
        _presence_payload("not_exists"), instance={}, ctx=ctx_absent,
    )
    assert out_absent.get("out") == "yes"
    # Present-empty → does NOT fire (key is in ctx, just empty)
    ctx_empty = _ctx(x="")
    out_empty = DerivationHandler.resolve(
        _presence_payload("not_exists"), instance={}, ctx=ctx_empty,
    )
    assert "out" not in out_empty


def test_resolve_is_set_op_requires_present_AND_non_empty():
    # Present + non-empty → fires
    ctx_full = _ctx(x="warm")
    out_full = DerivationHandler.resolve(
        _presence_payload("is_set"), instance={}, ctx=ctx_full,
    )
    assert out_full.get("out") == "yes"
    # Present + empty → does NOT fire (this is what differs from `exists`)
    ctx_empty = _ctx(x="")
    out_empty = DerivationHandler.resolve(
        _presence_payload("is_set"), instance={}, ctx=ctx_empty,
    )
    assert "out" not in out_empty
    # Absent → does NOT fire
    ctx_absent = _ctx()
    out_absent = DerivationHandler.resolve(
        _presence_payload("is_set"), instance={}, ctx=ctx_absent,
    )
    assert "out" not in out_absent


def test_resolve_is_unset_op_inverse_of_is_set():
    # Absent → fires
    ctx_absent = _ctx()
    out_absent = DerivationHandler.resolve(
        _presence_payload("is_unset"), instance={}, ctx=ctx_absent,
    )
    assert out_absent.get("out") == "yes"
    # Present + empty → fires (empty value counts as "unset")
    ctx_empty = _ctx(x="")
    out_empty = DerivationHandler.resolve(
        _presence_payload("is_unset"), instance={}, ctx=ctx_empty,
    )
    assert out_empty.get("out") == "yes"
    # Present + non-empty → does NOT fire
    ctx_full = _ctx(x="warm")
    out_full = DerivationHandler.resolve(
        _presence_payload("is_unset"), instance={}, ctx=ctx_full,
    )
    assert "out" not in out_full


def test_validate_payload_accepts_new_presence_ops():
    """The 4 new ops must pass _VALID_OPS validation."""
    for op in ("exists", "not_exists", "is_set", "is_unset"):
        DerivationHandler.validate_payload(_presence_payload(op))


def test_validate_payload_still_rejects_unknown_op_after_extension():
    """Regression — adding new ops shouldn't loosen unknown-op rejection."""
    with pytest.raises(ValueError, match="op must be one of"):
        DerivationHandler.validate_payload(_presence_payload("definitely_not_an_op"))
