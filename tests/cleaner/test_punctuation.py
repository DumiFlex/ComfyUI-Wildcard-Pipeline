"""Punctuation rule — strips orphan + edge punctuation."""
from engine.cleaner.rules.punctuation import apply


def test_strips_orphan_period_tag():
    result = apply(". , cfg, steps . avoid:", mode="tags", config={})
    assert "cfg" in result["text"]
    assert result["stats"]["stripped"] >= 1


def test_strips_trailing_colon_from_tag():
    result = apply("cfg, avoid:", mode="tags", config={})
    assert result["text"] == "cfg, avoid"
    assert result["stats"]["stripped"] == 1


def test_strips_leading_dot_from_tag():
    result = apply(". hello, world", mode="tags", config={})
    assert result["text"] == "hello, world"


def test_text_mode_strips_outer_punctuation():
    result = apply(". hello world :", mode="text", config={})
    assert result["text"] == "hello world"
    assert result["stats"]["stripped"] == 1


def test_text_mode_keeps_inner_punctuation():
    result = apply("hello, world. period", mode="text", config={})
    assert result["text"] == "hello, world. period"


def test_pure_apostrophe_tag_kept():
    result = apply("don't, cat", mode="tags", config={})
    assert "don't" in result["text"]


def test_empty_string_passthrough():
    result = apply("", mode="tags", config={})
    assert result["text"] == ""
    assert result["stats"]["stripped"] == 0


def test_idempotent():
    once = apply(". cfg, avoid:", mode="tags", config={})
    twice = apply(once["text"], mode="tags", config={})
    assert once["text"] == twice["text"]


def test_keeps_emoticon_tags():
    result = apply("-_-, :3, ^_^, >_<, o_o, :d, ;), ..., -", mode="tags", config={})
    assert result["text"] == "-_-, :3, ^_^, >_<, o_o, :d, ;)"


def test_text_mode_keeps_the_closing_full_stop():
    prose = "A cat sits. Then runs!"
    assert apply(prose, mode="text", config={})["text"] == prose
    assert apply("Wait...", mode="text", config={})["text"] == "Wait..."
    assert apply(", hello world,", mode="text", config={})["text"] == "hello world"
