"""Tag axes on a wildcard — payload validation, menus, rolls, constraint fold.

The feature exists because of one reported failure: an option tagged with three
tags from the same group excluded every option in the constrained target pool,
so the target silently returned `options[0]` forever. `test_reported_case_*`
below is that scenario end to end.
"""
import random

import pytest

from engine.modules._seed import derive_module_rng
from engine.modules.wildcard_handler import (
    WildcardHandler,
    _axis_menus,
    _roll_axes,
)


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


# ── menus + rolls ───────────────────────────────────────────────────────


def test_axis_menus_only_include_accepts_groups():
    payload = _payload(
        tag_groups={"SHOES": ["sneakers", "sandals"], "STYLE": ["casual"]},
        sub_categories=["sneakers", "sandals", "casual"],
        tag_group_kinds={"SHOES": "accepts"},
    )
    menus = _axis_menus(payload, ["sneakers", "sandals", "casual"])
    assert menus == {"SHOES": ["sneakers", "sandals"]}


def test_axis_menus_empty_when_option_has_no_axis_tag():
    payload = _payload(tag_group_kinds={"SHOES": "accepts"})
    assert _axis_menus(payload, ["casual"]) == {}


def test_roll_axes_is_reproducible_for_one_seed():
    menus = {"SHOES": ["sneakers", "high_heels", "sandals"]}
    a = _roll_axes(menus, derive_module_rng(42, "outfit::axis"))
    b = _roll_axes(menus, derive_module_rng(42, "outfit::axis"))
    assert a == b
    assert a["SHOES"] in menus["SHOES"]


# ── publication to ctx ──────────────────────────────────────────────────


_TWO_SHOE_OPTION = _payload(
    options=[{"id": "o1", "value": "tee", "sub_categories": ["sneakers", "sandals"]}],
    tag_group_kinds={"SHOES": "accepts"},
)


def test_axis_written_to_ctx_under_the_binding():
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_TWO_SHOE_OPTION, {"variable_binding": "outfit"}, ctx)
    assert ctx["__wp_axes__"]["outfit"]["SHOES"] in ("sneakers", "sandals")


def test_two_bindings_are_independent():
    # The axis read is keyed by BINDING, not module uuid, so it never inherits
    # the uuid-bucket collision that only reaches uuid-bound consumers.
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_TWO_SHOE_OPTION, {"variable_binding": "a"}, ctx)
    WildcardHandler.resolve(_TWO_SHOE_OPTION, {"variable_binding": "b"}, ctx)
    assert set(ctx["__wp_axes__"]) == {"a", "b"}


def test_pick_entry_carries_its_axis_menu():
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_TWO_SHOE_OPTION, {"variable_binding": "outfit"}, ctx)
    entry = ctx["__wp_picks__"]["abc12345"]
    assert entry["picks"][0]["axes"] == {"SHOES": ["sneakers", "sandals"]}


def test_no_accepts_group_means_no_axes_bucket_entry():
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_payload(), {"variable_binding": "outfit"}, ctx)
    assert ctx.get("__wp_axes__", {}).get("outfit") == {}
    assert ctx["__wp_picks__"]["abc12345"]["picks"][0]["axes"] == {}


def test_multi_pick_rolls_one_axis_per_pick():
    payload = _payload(
        options=[
            {"id": "o1", "value": "tee", "sub_categories": ["sneakers"]},
            {"id": "o2", "value": "gown", "sub_categories": ["sandals"]},
        ],
        tag_group_kinds={"SHOES": "accepts"},
    )
    ctx = _fresh_ctx()
    WildcardHandler.resolve(
        payload,
        {"variable_binding": "outfit", "pick_min": 2, "pick_max": 2},
        ctx,
    )
    rolled = ctx["__wp_axes__"]["outfit"]
    assert isinstance(rolled, list)
    assert len(rolled) == 2
    assert {r["SHOES"] for r in rolled} == {"sneakers", "sandals"}
