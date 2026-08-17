"""Tag axes on a wildcard — payload validation, menus, rolls, constraint fold.

The feature exists because of one reported failure: an option tagged with three
tags from the same group excluded every option in the constrained target pool,
so the target silently returned `options[0]` forever. `test_reported_case_*`
below is that scenario end to end.
"""
import random

import pytest

from engine.modules.wildcard_handler import WildcardHandler


def _payload(**over):
    base = {
        "options": [
            {"id": "o1", "value": "tee", "sub_categories": ["sneakers", "sandals"]},
        ],
        "sub_categories": ["sneakers", "sandals"],
        "tag_groups": {"SHOES": ["sneakers", "sandals"]},
        "var_binding": "outfit",
    }
    base.update(over)
    return base


def _fresh_ctx():
    """The minimum a handler needs. Mirrors what pipeline.py builds."""
    return {
        "__wp_rng__": random.Random(0),
        "__wp_node_seed__": 42,
        "__wp_warnings__": [],
        "__wp_current_module_id__": "abc12345",
    }


# ── payload validation ──────────────────────────────────────────────────


def test_accepts_kind_accepted():
    WildcardHandler.validate_payload(_payload(tag_group_kinds={"SHOES": "accepts"}))


def test_absent_kinds_still_valid():
    WildcardHandler.validate_payload(_payload())


def test_kind_naming_a_missing_group_rejected():
    with pytest.raises(ValueError, match="not a declared tag group"):
        WildcardHandler.validate_payload(_payload(tag_group_kinds={"NOPE": "accepts"}))


def test_unknown_kind_rejected():
    with pytest.raises(ValueError, match="must be 'classify' or 'accepts'"):
        WildcardHandler.validate_payload(_payload(tag_group_kinds={"SHOES": "menu"}))


def test_accepts_group_name_must_be_an_identifier():
    # `$var.AXIS` has to parse, so an accepts axis name is bound by the
    # accessor grammar in a way a classify group's name is not.
    with pytest.raises(ValueError, match="must be a valid identifier"):
        WildcardHandler.validate_payload(
            _payload(
                tag_groups={"My Shoes": ["sneakers", "sandals"]},
                tag_group_kinds={"My Shoes": "accepts"},
            )
        )


def test_classify_group_name_may_be_anything():
    WildcardHandler.validate_payload(
        _payload(
            tag_groups={"My Shoes": ["sneakers", "sandals"]},
            tag_group_kinds={"My Shoes": "classify"},
        )
    )
