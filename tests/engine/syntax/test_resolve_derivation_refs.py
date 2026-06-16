"""Derivation surface: @{} refs resolve in action.value (Layer A)."""
import random

from engine.modules import build_resolve_ctx
from engine.modules.derivation_handler import _match_condition
from engine.syntax import resolve_text


def _ctx(catalog):
    return {
        "__wp_rng__": random.Random(7),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog,
        "__wp_max_ref_depth__": 8,
    }


def test_ref_resolves_on_derivation_surface():
    catalog = {
        "aaaaaaaa": {
            "var_binding": "mood",
            "options": [{"id": "o1", "value": "calm", "weight": 1}],
        },
    }
    rctx = build_resolve_ctx(_ctx(catalog), surface="derivation")
    assert resolve_text("a @{aaaaaaaa} b", rctx) == "a calm b"


def test_condition_value_is_compared_raw_not_resolved():
    # Conditions compare the literal text — they never resolve @{} refs.
    cond = {"var": "x", "op": "equals", "value": "@{aaaaaaaa}"}
    assert _match_condition(cond, {"x": "@{aaaaaaaa}"}) is True
    assert _match_condition(cond, {"x": "calm"}) is False
