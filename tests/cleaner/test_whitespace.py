"""Whitespace rule — collapse runs, trim, fix stray commas."""
from engine.cleaner.rules.whitespace import apply


def test_collapse_double_spaces():
    result = apply("foo  bar   baz", mode="tags", config={})
    assert result["text"] == "foo bar baz"
    assert result["stats"]["fixed"] >= 1


def test_trim_outer_whitespace():
    result = apply("  hello  ", mode="text", config={})
    assert result["text"] == "hello"
    assert result["stats"]["fixed"] >= 1


def test_fix_stray_double_comma():
    result = apply("red,, blue,,, green", mode="tags", config={})
    assert result["text"] == "red, blue, green"


def test_strip_leading_trailing_comma():
    result = apply(", red, blue,", mode="tags", config={})
    assert result["text"] == "red, blue"


def test_empty_string_passthrough():
    result = apply("", mode="tags", config={})
    assert result["text"] == ""
    assert result["stats"]["fixed"] == 0


def test_only_whitespace_collapses_to_empty():
    result = apply("   \t  ", mode="text", config={})
    assert result["text"] == ""
    assert result["stats"]["fixed"] >= 1


def test_idempotent():
    once = apply("foo  bar", mode="tags", config={})
    twice = apply(once["text"], mode="tags", config={})
    assert once["text"] == twice["text"]


def test_drops_space_before_comma():
    result = apply("a knight ,, forest , tree", mode="tags", config={})
    assert result["text"] == "a knight, forest, tree"


def test_empty_slot_between_commas_collapses():
    # `a, , b`: the empty slot is spacing, so whitespace owns it (punctuation
    # drops tags made only of punctuation, like `a, ., b`).
    result = apply("blurry, , lowres, blurry", mode="tags", config={})
    assert result["text"] == "blurry, lowres, blurry"
