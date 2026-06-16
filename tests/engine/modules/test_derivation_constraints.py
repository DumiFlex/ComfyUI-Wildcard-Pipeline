"""A chain constraint re-weights a wildcard nested in a derivation action."""
import random

from engine.modules import build_resolve_ctx
from engine.modules.derivation_handler import DerivationHandler
from engine.syntax import resolve_text

# Shared catalog/constraint shape reused by all three tests:
#   TARGET_ID wildcard has two options — "yes" (no bad_opt) and "no"
#   (sub_category bad_opt). The constraint matrix zeroes out bad_opt
#   when the source pick carries "src_tag", leaving only "yes" reachable.
_TARGET_ID = "abcdef01"
_SOURCE_ID = "12345678"


def _make_ctx(
    *,
    extra: dict | None = None,
    target_select: dict | None = None,
) -> dict:
    """Build a minimal pipeline ctx for constraint tests.

    ``target_select`` overrides the constraint's target_select.
    ``extra`` is merged into the ctx dict (e.g. to add var keys).
    """
    catalog = {
        _TARGET_ID: {"var_binding": "tw", "options": [
            {"id": "yes", "value": "yes", "weight": 1, "sub_categories": []},
            {"id": "no",  "value": "no",  "weight": 1, "sub_categories": ["bad_opt"]},
        ]},
    }
    ts = target_select if target_select is not None else {"mode": "all"}
    constraints = [{
        "source_wildcard_id": _SOURCE_ID, "target_wildcard_id": _TARGET_ID,
        "matrix": {"src_tag": {"bad_opt": {"mode": "exclude", "factor": 0.0}}},
        "exceptions": [],
        "target_select": ts,
        "__constraint_module_id__": "cn-uid",
    }]
    picks = {_SOURCE_ID: {
        "value": "sv", "sub_categories": ["src_tag"],
        "picks": [{"value": "sv", "tags": ["src_tag"]}],
    }}
    ctx: dict = {
        "__wp_rng__": random.Random(1),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog,
        "__wp_constraints__": constraints,
        "__wp_picks__": picks,
        "__wp_constraint_hits__": {},
        "__wp_max_ref_depth__": 8,
    }
    if extra:
        ctx.update(extra)
    return ctx


def test_constraint_excludes_nested_target_option():
    # UUID tokens require exactly 8 lowercase hex chars ([0-9a-f]{8}).
    # The constraint excludes options with sub_category "bad_opt" when the
    # source pick carries tag "src_tag".  Only "yes" lacks that sub_category,
    # so every roll produces "yes" deterministically.
    ctx = _make_ctx()
    rctx = build_resolve_ctx(ctx, surface="derivation")
    assert resolve_text(f"@{{{_TARGET_ID}}}", rctx) == "yes"


def test_pick_reach_matches_derivation_branch_key():
    # A `pick` target_select keyed on (deriv-uid, "r1:0") restricts the
    # constraint to the IF branch (bi=0) of rule "r1".  When the branch
    # fires, _apply_action stamps the carrier → "no" is excluded → "yes".
    DERIV_UID = "deriv-uid"
    target_select = {
        "mode": "pick",
        "picks": [{"kind": "nested", "carrier_uid": DERIV_UID, "option_id": "r1:0"}],
    }
    ctx = _make_ctx(
        target_select=target_select,
        extra={
            "__wp_node_seed__": 1,
            "__wp_current_module_uid__": DERIV_UID,
            "__wp_current_module_id__": "deriv-lib",
            "x": "1",  # makes "exists" condition TRUE → IF branch fires
        },
    )
    payload = {
        "rules": [{
            "id": "r1",
            "branches": [{
                "condition": {"var": "x", "op": "exists"},
                "action": {
                    "target_var": "out",
                    "mode": "replace",
                    "value": f"@{{{_TARGET_ID}}}",
                },
            }],
            "else": None,
        }],
    }
    DerivationHandler.resolve(payload, {}, ctx)
    assert ctx["out"] == "yes"


def test_pick_reach_matches_derivation_else_key():
    # A `pick` target_select keyed on (deriv-uid, "r1:else") restricts the
    # constraint to the ELSE clause of rule "r1".  When the IF condition is
    # FALSE (var "x" is absent), the else action fires with the carrier
    # stamped as "r1:else" → "no" is excluded → "yes".
    DERIV_UID = "deriv-uid"
    target_select = {
        "mode": "pick",
        "picks": [{"kind": "nested", "carrier_uid": DERIV_UID, "option_id": "r1:else"}],
    }
    ctx = _make_ctx(
        target_select=target_select,
        extra={
            "__wp_node_seed__": 1,
            "__wp_current_module_uid__": DERIV_UID,
            "__wp_current_module_id__": "deriv-lib",
            # "x" deliberately absent → "exists" condition is FALSE → else fires
        },
    )
    payload = {
        "rules": [{
            "id": "r1",
            "branches": [{
                "condition": {"var": "x", "op": "exists"},
                "action": {
                    "target_var": "out",
                    "mode": "replace",
                    "value": "branch-value",  # never reached
                },
            }],
            "else": {
                "action": {
                    "target_var": "out",
                    "mode": "replace",
                    "value": f"@{{{_TARGET_ID}}}",
                },
            },
        }],
    }
    DerivationHandler.resolve(payload, {}, ctx)
    assert ctx["out"] == "yes"
