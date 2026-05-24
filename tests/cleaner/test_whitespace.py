"""Whitespace rule — collapse runs, trim, fix stray commas.

Tags mode + text mode both apply the same normalization; the rule is
input-shape-agnostic.
"""
from engine.cleaner.rules.whitespace import apply


def test_collapse_double_spaces():
    result = apply("foo  bar   baz", mode="tags", ctx=None, config={})
    assert result["text"] == "foo bar baz"
    assert result["stats"]["fixed"] >= 1


def test_trim_outer_whitespace():
    result = apply("  hello  ", mode="text", ctx=None, config={})
    assert result["text"] == "hello"
    assert result["stats"]["fixed"] >= 1


def test_fix_stray_double_comma():
    result = apply("red,, blue,,, green", mode="tags", ctx=None, config={})
    assert result["text"] == "red, blue, green"


def test_strip_leading_trailing_comma():
    result = apply(", red, blue,", mode="tags", ctx=None, config={})
    assert result["text"] == "red, blue"


def test_empty_string_passthrough():
    result = apply("", mode="tags", ctx=None, config={})
    assert result["text"] == ""
    assert result["stats"]["fixed"] == 0


def test_only_whitespace_collapses_to_empty():
    result = apply("   \t  ", mode="text", ctx=None, config={})
    assert result["text"] == ""
    assert result["stats"]["fixed"] >= 1


def test_idempotent():
    """Running twice produces same output as running once."""
    once = apply("foo  bar", mode="tags", ctx=None, config={})
    twice = apply(once["text"], mode="tags", ctx=None, config={})
    assert once["text"] == twice["text"]
