"""Null-slot cleanup — strip empty fragments left behind by null-option picks.

Engine-side, a wildcard option with is_null=true returns "" at runtime.
That "" embedded in a comma-separated template leaves a stray
`, , ...` artifact in the assembled prompt. This rule scrubs those
artifacts when the cleaner can confirm via CleanerCtx that the empty
came from a null pick (not just typo-empty).
"""
from engine.cleaner.rules.null_slot import apply
from engine.cleaner.types import CleanerCtx


def test_strips_stray_comma_after_null_pick():
    ctx = CleanerCtx(picks={"wc_mood": {"value": "", "is_null": True}})
    result = apply("portrait, , brown eyes", mode="tags", ctx=ctx, config={})
    assert result["text"] == "portrait, brown eyes"
    assert result["stats"]["stripped"] == 1


def test_strips_multiple_adjacent_null_artifacts():
    ctx = CleanerCtx(picks={
        "wc_a": {"value": "", "is_null": True},
        "wc_b": {"value": "", "is_null": True},
    })
    result = apply("red, , , blue", mode="tags", ctx=ctx, config={})
    assert result["text"] == "red, blue"
    assert result["stats"]["stripped"] >= 1


def test_no_op_when_no_null_picks_in_ctx():
    """Empty fragments survive when no null pick justifies the strip."""
    ctx = CleanerCtx(picks={"wc_hair": {"value": "pixie cut"}})
    result = apply("red, , blue", mode="tags", ctx=ctx, config={})
    assert result["text"] == "red, , blue"
    assert result["stats"]["stripped"] == 0


def test_silent_skip_when_ctx_none():
    result = apply("red, , blue", mode="tags", ctx=None, config={})
    assert result["text"] == "red, , blue"
    assert result["stats"] == {}


def test_text_mode_strips_double_space_around_empty():
    ctx = CleanerCtx(picks={"wc_mood": {"value": "", "is_null": True}})
    result = apply("a  mood, b weather", mode="text", ctx=ctx, config={})
    assert result["text"] == "a mood, b weather"
    assert result["stats"]["stripped"] == 1
