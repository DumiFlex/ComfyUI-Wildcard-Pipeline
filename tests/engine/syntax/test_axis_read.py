"""`$outfit.SHOES` reads the tag rolled at pick time — it never re-rolls.

That is the whole consistency guarantee: two modules, or two chained nodes,
read the same stored value rather than each drawing their own.
"""
import random

from engine.modules import build_resolve_ctx
from engine.syntax import resolve_text


def _ctx(axes):
    return {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_axes__": axes,
        "outfit": "white t-shirt",
    }


def test_single_pick_axis_reads_the_rolled_tag():
    rc = build_resolve_ctx(_ctx({"outfit": {"SHOES": "sandals"}}), surface="combine")
    assert resolve_text("wearing $outfit.SHOES", rc) == "wearing sandals"


def test_multi_pick_bare_read_joins():
    rc = build_resolve_ctx(
        _ctx({"outfit": [{"SHOES": "sandals"}, {"SHOES": "sneakers"}]}),
        surface="combine",
    )
    assert resolve_text("$outfit.SHOES", rc) == "sandals, sneakers"


def test_multi_pick_index_selects_one_in_either_order():
    rc = build_resolve_ctx(
        _ctx({"outfit": [{"SHOES": "sandals"}, {"SHOES": "sneakers"}]}),
        surface="combine",
    )
    assert resolve_text("$outfit.1.SHOES", rc) == "sneakers"
    assert resolve_text("$outfit.SHOES.1", rc) == "sneakers"


def test_multi_pick_index_keeps_its_slot_when_a_pick_has_no_axis_tag():
    # Pick 0 ("robe") carries no SHOES tag. `.1` must still mean pick 1, the
    # same pick `$outfit.1` names, not slide down onto pick 0's empty slot.
    c = _ctx({"outfit": [{}, {"SHOES": "boots"}]})
    rc = build_resolve_ctx(c, surface="combine")
    assert resolve_text("$outfit.0.SHOES", rc) == ""
    assert resolve_text("$outfit.1.SHOES", rc) == "boots"
    assert resolve_text("$outfit.SHOES", rc) == "boots"
    assert not any(w["type"] == "unknown_tag_axis" for w in c["__wp_warnings__"])


def test_multi_pick_index_out_of_range_is_empty():
    rc = build_resolve_ctx(
        _ctx({"outfit": [{"SHOES": "sandals"}]}), surface="combine",
    )
    assert resolve_text("$outfit.4.SHOES", rc) == ""


def test_single_pick_behaves_as_a_one_element_list():
    # Mirrors deref_var_value's contract so the two accessors agree.
    rc = build_resolve_ctx(_ctx({"outfit": {"SHOES": "sandals"}}), surface="combine")
    assert resolve_text("$outfit.0.SHOES", rc) == "sandals"
    assert resolve_text("$outfit.9.SHOES", rc) == ""


def test_reading_the_same_axis_twice_gives_one_answer():
    # The point of rolling at pick time. A lazy roll would make these differ.
    rc = build_resolve_ctx(_ctx({"outfit": {"SHOES": "sandals"}}), surface="combine")
    assert resolve_text("$outfit.SHOES / $outfit.SHOES", rc) == "sandals / sandals"


def test_unknown_axis_renders_empty_and_warns():
    c = _ctx({"outfit": {"SHOES": "sandals"}})
    rc = build_resolve_ctx(c, surface="combine")
    assert resolve_text("$outfit.BELTS", rc) == ""
    assert any(w["type"] == "unknown_tag_axis" for w in c["__wp_warnings__"])


def test_axis_on_a_binding_that_rolled_nothing_warns():
    c = _ctx({})
    rc = build_resolve_ctx(c, surface="combine")
    assert resolve_text("$outfit.SHOES", rc) == ""
    assert any(w["type"] == "unknown_tag_axis" for w in c["__wp_warnings__"])


def test_plain_var_read_is_untouched():
    rc = build_resolve_ctx(_ctx({"outfit": {"SHOES": "sandals"}}), surface="combine")
    assert resolve_text("$outfit", rc) == "white t-shirt"
