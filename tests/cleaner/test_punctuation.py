"""Punctuation rule — strips orphan + edge punctuation."""
from engine.cleaner.rules.punctuation import apply


def test_strips_orphan_period_tag():
    result = apply(". , cfg, steps . avoid:", mode="tags", ctx=None, config={})
    # Lone "." is pure punctuation -> dropped. Trailing `:` stripped from
    # "avoid:". Whitespace pass would have come earlier; punctuation runs
    # after that.
    assert "cfg" in result["text"]
    assert "steps . avoid" in result["text"]
    assert result["text"].startswith("cfg") or result["text"].startswith("steps")
    assert result["stats"]["stripped"] >= 1


def test_strips_trailing_colon_from_tag():
    result = apply("cfg, avoid:", mode="tags", ctx=None, config={})
    assert result["text"] == "cfg, avoid"
    assert result["stats"]["stripped"] == 1


def test_strips_leading_dot_from_tag():
    result = apply(". hello, world", mode="tags", ctx=None, config={})
    assert result["text"] == "hello, world"


def test_text_mode_strips_outer_punctuation():
    result = apply(". hello world :", mode="text", ctx=None, config={})
    assert result["text"] == "hello world"
    assert result["stats"]["stripped"] == 1


def test_text_mode_keeps_inner_punctuation():
    result = apply("hello, world. period", mode="text", ctx=None, config={})
    assert result["text"] == "hello, world. period"


def test_pure_apostrophe_tag_kept():
    """Apostrophes are not considered punctuation here — don't drop legitimate tags."""
    result = apply("don't, cat", mode="tags", ctx=None, config={})
    assert "don't" in result["text"]


def test_empty_string_passthrough():
    result = apply("", mode="tags", ctx=None, config={})
    assert result["text"] == ""
    assert result["stats"]["stripped"] == 0


def test_idempotent():
    once = apply(". cfg, avoid:", mode="tags", ctx=None, config={})
    twice = apply(once["text"], mode="tags", ctx=None, config={})
    assert once["text"] == twice["text"]
