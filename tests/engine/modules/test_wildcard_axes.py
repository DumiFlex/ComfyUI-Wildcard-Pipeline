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


def test_pick_entry_collapses_accepts_axis_to_the_rolled_winner():
    # An accepts axis sends its SINGLE rolled winner to the constraint, not the
    # whole menu — so a diagonal pins the target to the rolled tag instead of
    # narrowing to the entire accepted set (the reported "picks are not good").
    # The winner recorded on the pick is the same one `$var.AXIS` exposes.
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_TWO_SHOE_OPTION, {"variable_binding": "outfit"}, ctx)
    pick = ctx["__wp_picks__"]["abc12345"]["picks"][0]
    winner = ctx["__wp_axes__"]["outfit"]["SHOES"]
    assert winner in ("sneakers", "sandals")
    assert pick["axes"] == {"SHOES": [winner]}
    # The non-rolled sibling is gone from the flat constraint tag bag too.
    assert pick["tags"] == [winner]


def test_no_accepts_group_means_no_axes_bucket_entry():
    ctx = _fresh_ctx()
    WildcardHandler.resolve(_payload(), {"variable_binding": "outfit"}, ctx)
    assert ctx.get("__wp_axes__", {}).get("outfit") == {}
    assert ctx["__wp_picks__"]["abc12345"]["picks"][0]["axes"] == {}


# ── the reported failure, end to end ────────────────────────────────────


def _shoe_options(shoes):
    return [{"id": s, "value": s, "weight": 1, "sub_categories": [s]} for s in shoes]


def _diagonal(shoes, sources=None):
    """A 'same tag wins, everything else is out' matrix — the obvious rule a
    user writes when linking two wildcards."""
    return {
        src: {tgt: {"mode": "allow" if src == tgt else "exclude"} for tgt in shoes}
        for src in (sources or shoes)
    }


def test_reported_case_narrows_to_the_option_menu():
    """The bug this feature exists for: an option tagged with three shoe tags
    used to zero every target and fall through to options[0] forever."""
    from engine.modules.wildcard_handler import _apply_constraint_to_options

    menu = ["sneakers", "high_heels", "sandals"]
    source_pick = {
        "value": "white t-shirt, denim skirt",
        "sub_categories": ["casual", *menu],
        "picks": [{
            "value": "white t-shirt, denim skirt",
            "tags": ["casual", *menu],
            "axes": {"SHOES": menu},
        }],
    }
    shoes = ["sneakers", "boots", "high_heels", "stiletto_heels", "sandals", "oxfords"]
    out = _apply_constraint_to_options(
        _shoe_options(shoes),
        {"matrix": _diagonal(shoes, sources=menu), "exceptions": []},
        source_pick,
    )
    assert {o["id"] for o in out if o["weight"] > 0} == set(menu)


def _two_pick_source(menu_a, menu_b):
    return {
        "value": "tee, jacket",
        "picks": [
            {"value": "tee", "tags": list(menu_a), "axes": {"SHOES": list(menu_a)}},
            {"value": "jacket", "tags": list(menu_b), "axes": {"SHOES": list(menu_b)}},
        ],
    }


def test_multi_pick_menus_intersect():
    """Spec 5.5: worn together, garments each veto shoes they disagree with.
    A union would pair a ball gown with sneakers because one garment allowed
    it."""
    from engine.modules.wildcard_handler import _apply_constraint_to_options

    shoes = ["sneakers", "boots", "high_heels", "sandals"]
    out = _apply_constraint_to_options(
        _shoe_options(shoes),
        {"matrix": _diagonal(shoes), "exceptions": []},
        _two_pick_source(["sneakers", "high_heels", "sandals"], ["sneakers", "boots"]),
    )
    assert {o["id"] for o in out if o["weight"] > 0} == {"sneakers"}


def test_disjoint_menus_empty_the_pool():
    """Documented consequence of intersecting: garments sharing no shoe leave
    nothing. Visible via constraint_excludes_all_options; the options[0]
    fallback itself is a separate follow-up, not this branch."""
    from engine.modules.wildcard_handler import _apply_constraint_to_options

    shoes = ["sneakers", "stiletto_heels"]
    out = _apply_constraint_to_options(
        _shoe_options(shoes),
        {"matrix": _diagonal(shoes), "exceptions": []},
        _two_pick_source(["sneakers"], ["stiletto_heels"]),
    )
    assert all(o["weight"] == 0 for o in out)


def test_source_without_axes_still_folds_as_before():
    """The regression lock: no `axes` on the pick means the flat product, so
    the old all-excluded outcome is preserved for legacy records."""
    from engine.modules.wildcard_handler import _apply_constraint_to_options

    menu = ["sneakers", "high_heels", "sandals"]
    shoes = ["sneakers", "boots", "high_heels", "sandals"]
    out = _apply_constraint_to_options(
        _shoe_options(shoes),
        {"matrix": _diagonal(shoes, sources=menu), "exceptions": []},
        {"value": "tee", "picks": [{"value": "tee", "tags": menu}]},
    )
    assert all(o["weight"] == 0 for o in out)


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
