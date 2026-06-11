"""A chain constraint re-weights a wildcard nested in a derivation action."""
import random

from engine.modules import build_resolve_ctx
from engine.syntax import resolve_text


def test_constraint_excludes_nested_target_option():
    # UUID tokens require exactly 8 lowercase hex chars ([0-9a-f]{8}).
    # The constraint excludes options with sub_category "bad_opt" when the
    # source pick carries tag "src_tag".  Only "yes" lacks that sub_category,
    # so every roll produces "yes" deterministically.
    TARGET_ID = "abcdef01"
    SOURCE_ID = "12345678"
    catalog = {
        TARGET_ID: {"var_binding": "tw", "options": [
            {"id": "yes", "value": "yes", "weight": 1, "sub_categories": []},
            {"id": "no", "value": "no", "weight": 1, "sub_categories": ["bad_opt"]},
        ]},
    }
    constraints = [{
        "source_wildcard_id": SOURCE_ID, "target_wildcard_id": TARGET_ID,
        "matrix": {"src_tag": {"bad_opt": {"mode": "exclude", "factor": 0.0}}},
        "exceptions": [],
        "target_select": {"mode": "all"}, "__constraint_module_id__": "cn-uid",
    }]
    picks = {SOURCE_ID: {"value": "sv", "sub_categories": ["src_tag"],
                         "picks": [{"value": "sv", "tags": ["src_tag"]}]}}
    ctx = {
        "__wp_rng__": random.Random(1), "__wp_warnings__": [], "__wp_catalog__": catalog,
        "__wp_constraints__": constraints, "__wp_picks__": picks,
        "__wp_constraint_hits__": {}, "__wp_max_ref_depth__": 8,
    }
    rctx = build_resolve_ctx(ctx, surface="derivation")
    assert resolve_text(f"@{{{TARGET_ID}}}", rctx) == "yes"
