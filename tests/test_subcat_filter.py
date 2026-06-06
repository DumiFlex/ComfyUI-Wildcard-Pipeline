import pytest

from engine.syntax.subcat_filter import (
    ParseError,
    matches,
    parse,
    reads_as,
    validate_expression,
    validate_subcat_name,
)


# ---- parse ----------------------------------------------------------------
def test_single_tag():
    assert parse("warm") == {"tag": "warm"}


def test_or_chain_flattens():
    assert parse("a or b or c") == {
        "op": "or", "kids": [{"tag": "a"}, {"tag": "b"}, {"tag": "c"}]
    }


def test_comma_is_or():
    assert parse("a,b") == {"op": "or", "kids": [{"tag": "a"}, {"tag": "b"}]}


def test_precedence_and_binds_tighter():
    assert parse("a or b and c") == {
        "op": "or",
        "kids": [{"tag": "a"}, {"op": "and", "kids": [{"tag": "b"}, {"tag": "c"}]}],
    }


def test_not_unary():
    assert parse("not a") == {"op": "not", "x": {"tag": "a"}}


def test_parens_group():
    assert parse("(a or b) and c") == {
        "op": "and",
        "kids": [{"op": "or", "kids": [{"tag": "a"}, {"tag": "b"}]}, {"tag": "c"}],
    }


def test_empty_is_none():
    assert parse("") is None
    assert parse("   ") is None


def test_unbalanced_paren_raises():
    with pytest.raises(ParseError, match="paren"):
        parse("(a or b")


def test_missing_operator_raises():
    with pytest.raises(ParseError, match="operator"):
        parse("pink not green")


def test_trailing_operator_raises():
    with pytest.raises(ParseError):
        parse("a or")


# ---- matches --------------------------------------------------------------
def test_matches_basic():
    assert matches(parse("warm or cold"), {"warm"}) is True
    assert matches(parse("warm and cold"), {"warm"}) is False
    assert matches(parse("warm and cold"), {"warm", "cold"}) is True
    assert matches(parse("not green"), {"warm"}) is True
    assert matches(parse("not green"), {"green"}) is False
    assert matches(None, set()) is True
    assert matches(parse("(red or pink) and not cold"), {"red", "warm"}) is True
    assert matches(parse("(red or pink) and not cold"), {"red", "cold"}) is False


# ---- reads_as -------------------------------------------------------------
def test_reads_as_flattens_and_parenthesizes():
    assert reads_as(parse("(blue or red) or pink")) == "blue or red or pink"
    assert (
        reads_as(parse("blue or red or pink and not green"))
        == "blue or red or (pink and not green)"
    )
    assert (
        reads_as(parse("( (blue or red) or pink and warm ) and not green"))
        == "(blue or red or (pink and warm)) and not green"
    )
    assert reads_as(None) == ""


# ---- validate_subcat_name -------------------------------------------------
def test_validate_subcat_name():
    assert validate_subcat_name("warm") is None
    assert validate_subcat_name("warm-tones") is None
    assert validate_subcat_name("warm_tones") is None
    assert "whitespace" in validate_subcat_name("warm tones")
    assert "character" in validate_subcat_name("a(b")
    assert "character" in validate_subcat_name("a!b")
    assert "reserved" in validate_subcat_name("or")
    assert "reserved" in validate_subcat_name("OR")
    assert "reserved" in validate_subcat_name("null")
    assert "empty" in validate_subcat_name("")


# ---- validate_expression --------------------------------------------------
def test_validate_expression():
    known = {"warm", "cold", "red", "pink"}
    assert validate_expression("warm or cold", known) is None
    assert validate_expression("", known) is None
    assert "Unknown" in validate_expression("warm or banana", known)
    assert "paren" in validate_expression("(warm or cold", known)
    assert "operator" in validate_expression("pink not warm", known)
    assert "reserved" in validate_expression("warm or null", known)
