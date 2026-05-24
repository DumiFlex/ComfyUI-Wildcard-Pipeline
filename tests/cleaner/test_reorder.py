"""Reorder rule — tags mode only.

Sorts tags by sub_category bucket using ctx.picks metadata. Stable
sort: known sub-cats sort first in registry order, unknown tags
preserve their relative order at the tail.
"""
from engine.cleaner.rules.reorder import apply
from engine.cleaner.types import CleanerCtx


def _ctx_with_subcats(**by_value: str) -> CleanerCtx:
    picks = {
        f"wc_{value}": {"value": value, "sub_category": cat}
        for value, cat in by_value.items()
    }
    return CleanerCtx(picks=picks)


def test_reorders_by_subcategory_bucket():
    ctx = _ctx_with_subcats(red="color", warm="palette", cotton="fabric")
    result = apply("warm, cotton, red", mode="tags", ctx=ctx, config={})
    assert result["text"] == "red, warm, cotton"
    assert result["stats"]["reordered"] >= 1


def test_unknown_tags_preserve_relative_order_at_tail():
    ctx = _ctx_with_subcats(red="color")
    result = apply("unknown1, red, unknown2", mode="tags", ctx=ctx, config={})
    assert result["text"] == "red, unknown1, unknown2"


def test_silent_skip_when_ctx_none():
    result = apply("red, blue", mode="tags", ctx=None, config={})
    assert result["text"] == "red, blue"
    assert result["stats"] == {}


def test_no_op_in_text_mode():
    ctx = _ctx_with_subcats(red="color")
    result = apply("red and blue", mode="text", ctx=ctx, config={})
    assert result["text"] == "red and blue"
    assert result["stats"] == {"reordered": 0}


def test_no_picks_no_op():
    ctx = CleanerCtx()
    result = apply("red, blue", mode="tags", ctx=ctx, config={})
    assert result["text"] == "red, blue"
    assert result["stats"] == {"reordered": 0}
