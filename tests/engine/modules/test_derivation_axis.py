"""A derivation condition can test a rolled axis.

This is the reported ask, written out: "IF location = outdoors, append one of
the tags from SHOES". Conditions read `condition.var` as a raw string rather
than a token, so this path parses the accessor itself.
"""
import random

from engine.modules.derivation_handler import DerivationHandler


def _ctx(axes=None):
    return {
        "__wp_rng__": random.Random(0),
        "__wp_node_seed__": 1,
        "__wp_warnings__": [],
        "__wp_axes__": {"outfit": {"SHOES": "sandals"}} if axes is None else axes,
        "outfit": "white t-shirt",
        "location": "outdoors",
    }


def _rule(var, op="equals", value="sandals"):
    return {
        "rules": [{
            "id": "r1",
            "branches": [{
                "condition": {"var": var, "op": op, "value": value},
                "action": {
                    "target_var": "footwear",
                    "mode": "replace",
                    "value": "strappy sandals",
                },
            }],
        }]
    }


def test_condition_reads_an_axis():
    assert DerivationHandler.resolve(
        _rule("outfit.SHOES"), {}, _ctx(),
    )["footwear"] == "strappy sandals"


def test_condition_on_a_missing_axis_is_falsy_not_an_error():
    # Derivations are control flow, not validation: a condition that cannot be
    # answered is simply false.
    assert DerivationHandler.resolve(_rule("outfit.SHOES"), {}, _ctx(axes={})) == {}


def test_exists_op_sees_an_axis():
    assert DerivationHandler.resolve(
        _rule("outfit.SHOES", op="exists", value=""), {}, _ctx(),
    )["footwear"] == "strappy sandals"


def test_exists_op_is_false_for_an_undeclared_axis():
    assert DerivationHandler.resolve(
        _rule("outfit.BELTS", op="exists", value=""), {}, _ctx(),
    ) == {}


def test_multi_pick_axis_joins_for_a_bare_read():
    ctx = _ctx(axes={"outfit": [{"SHOES": "sandals"}, {"SHOES": "sneakers"}]})
    assert DerivationHandler.resolve(
        _rule("outfit.SHOES", value="sandals, sneakers"), {}, ctx,
    )["footwear"] == "strappy sandals"


def test_multi_pick_axis_indexes_in_either_order():
    ctx = _ctx(axes={"outfit": [{"SHOES": "sandals"}, {"SHOES": "sneakers"}]})
    for var in ("outfit.1.SHOES", "outfit.SHOES.1"):
        assert DerivationHandler.resolve(
            _rule(var, value="sneakers"), {}, _ctx(axes=ctx["__wp_axes__"]),
        )["footwear"] == "strappy sandals"


def test_plain_var_condition_is_untouched():
    assert DerivationHandler.resolve(
        _rule("location", value="outdoors"), {}, _ctx(),
    )["footwear"] == "strappy sandals"


def test_action_can_emit_the_axis_value():
    """The literal reported ask: when outdoors, append one of the SHOES tags."""
    payload = {
        "rules": [{
            "id": "r1",
            "branches": [{
                "condition": {"var": "location", "op": "equals", "value": "outdoors"},
                "action": {
                    "target_var": "footwear",
                    "mode": "replace",
                    "value": "$outfit.SHOES",
                },
            }],
        }]
    }
    assert DerivationHandler.resolve(payload, {}, _ctx())["footwear"] == "sandals"
