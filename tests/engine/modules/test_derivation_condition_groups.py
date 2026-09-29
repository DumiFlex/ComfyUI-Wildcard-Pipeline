"""AND / OR condition groups and the emptiness ops (schema v7)."""
import random

import pytest

from engine.modules.derivation_handler import (
    DerivationHandler,
    condition_leaves,
    condition_override_key,
)


def _t(var, op="equals", value=""):
    return {"var": var, "op": op, "value": value}


def _payload(condition, else_value=None):
    rule = {"id": "r1", "branches": [{
        "condition": condition,
        "action": {"target_var": "out", "mode": "replace", "value": "hit"},
    }]}
    if else_value is not None:
        rule["else"] = {"action": {"target_var": "out", "mode": "replace", "value": else_value}}
    return {"rules": [rule]}


def _run(condition, instance=None, **ctx_vars):
    ctx = {"__wp_rng__": random.Random(0), "__wp_warnings__": [], **ctx_vars}
    DerivationHandler.resolve(_payload(condition, else_value="miss"), instance or {}, ctx)
    return ctx["out"]


AND = {"match": "all", "conditions": [_t("a", value="1"), _t("b", value="2")]}
OR = {"match": "any", "conditions": [_t("a", value="1"), _t("b", value="2")]}


@pytest.mark.parametrize("a, b, and_out, or_out", [
    ("1", "2", "hit", "hit"),
    ("1", "x", "miss", "hit"),
    ("x", "2", "miss", "hit"),
    ("x", "x", "miss", "miss"),
])
def test_and_or(a, b, and_out, or_out):
    assert _run(AND, a=a, b=b) == and_out
    assert _run(OR, a=a, b=b) == or_out


def test_nested_group_mixes_and_with_or():
    # a == 1 AND (b == 2 OR c exists)
    cond = {"match": "all", "conditions": [
        _t("a", value="1"),
        {"match": "any", "conditions": [_t("b", value="2"), _t("c", op="exists")]},
    ]}
    assert _run(cond, a="1", b="2") == "hit"
    assert _run(cond, a="1", b="x", c="") == "hit"
    assert _run(cond, a="1", b="x") == "miss"
    assert _run(cond, a="x", b="2") == "miss"


def test_single_test_branch_still_works():
    assert _run(_t("a", value="1"), a="1") == "hit"
    assert _run(_t("a", value="1"), a="2") == "miss"


@pytest.mark.parametrize("op, ctx, expected", [
    ("is_empty", {"a": ""}, "hit"),
    ("is_empty", {"a": "x"}, "miss"),
    ("is_empty", {}, "miss"),  # absent is not "set and empty"
    ("is_not_empty", {"a": "x"}, "hit"),
    ("is_not_empty", {"a": ""}, "miss"),
    ("is_not_empty", {}, "miss"),
])
def test_emptiness_ops(op, ctx, expected):
    DerivationHandler.validate_payload(_payload(_t("a", op=op)))
    assert _run(_t("a", op=op), **ctx) == expected


def test_value_overrides_address_each_test():
    cond = {"match": "all", "conditions": [
        _t("a", value="1"),
        {"match": "any", "conditions": [_t("b", value="2"), _t("c", value="3")]},
    ]}
    # Leaves depth-first: a (key "0"), b ("0.1"), c ("0.2").
    assert [condition_override_key(0, k) for k in range(3)] == ["0", "0.1", "0.2"]
    instance = {"condition_value_overrides": {"r1": {"0": "9", "0.2": "7"}}}
    assert _run(cond, instance, a="9", b="x", c="7") == "hit"
    assert _run(cond, instance, a="1", b="2") == "miss"  # a's value is now 9


def test_condition_leaves_depth_first():
    cond = {"match": "all", "conditions": [
        _t("a"), {"match": "any", "conditions": [_t("b"), _t("c")]}, _t("d"),
    ]}
    assert [leaf["var"] for leaf in condition_leaves(cond)] == ["a", "b", "c", "d"]


@pytest.mark.parametrize("condition, message", [
    ({"match": "both", "conditions": [_t("a")]}, "match must be one of"),
    ({"match": "all", "conditions": []}, "non-empty list"),
    ({"match": "all", "conditions": "a"}, "non-empty list"),
    ({"match": "all", "conditions": [_t("")]}, "var must be a non-empty string"),
    ({"match": "all", "conditions": [_t("a", op="nope")]}, "op must be one of"),
])
def test_validate_rejects_bad_groups(condition, message):
    with pytest.raises(ValueError, match=message):
        DerivationHandler.validate_payload(_payload(condition))


def test_validate_caps_depth():
    cond = _t("a")
    for _ in range(9):
        cond = {"match": "all", "conditions": [cond]}
    with pytest.raises(ValueError, match="nests deeper"):
        DerivationHandler.validate_payload(_payload(cond))
