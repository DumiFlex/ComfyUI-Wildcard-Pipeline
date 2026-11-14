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


# ---- variables (schema v11) ------------------------------------------------
def test_variables_lists_each_var_once_in_order():
    from engine.syntax.subcat_filter import variables
    ast = parse("$b and (warm or not $a) and $b")
    assert variables(ast) == ["b", "a"]
    assert variables(None) == []
    assert variables(parse("warm")) == []


def test_expr_variables_handles_text_and_bad_input():
    from engine.syntax.subcat_filter import expr_variables
    assert expr_variables("warm and $model_variant") == ["model_variant"]
    assert expr_variables("warm") == []
    assert expr_variables(None) == []
    assert expr_variables("$x and (") == []


def test_drop_vars_removes_var_terms_and_empty_groups():
    from engine.syntax.subcat_filter import drop_vars
    assert drop_vars(parse("$x")) is None
    assert drop_vars(parse("warm and $x")) == {"tag": "warm"}
    assert drop_vars(parse("not $x and cool")) == {"tag": "cool"}
    assert drop_vars(parse("not warm")) == {"op": "not", "x": {"tag": "warm"}}


def test_values_of_lists_text_and_unset():
    from engine.syntax.subcat_filter import values_of

    class Picks:
        items = ["pony", "flux"]

    assert values_of(None) == []
    assert values_of("  ") == []
    assert values_of("pony") == ["pony"]
    assert values_of(Picks()) == ["pony", "flux"]


def test_wildcard_tags_collects_declared_and_option_tags():
    from engine.syntax.subcat_filter import wildcard_tags
    payload = {
        "sub_categories": ["pony", 3],
        "options": [{"sub_categories": ["pony", "illustrious"]}, "bad", {}],
    }
    assert wildcard_tags(payload) == ["pony", "illustrious"]
    assert wildcard_tags(None) == []


def test_bind_for_wildcard_binds_against_payload():
    from engine.syntax.subcat_filter import bind_for_wildcard
    payload = {
        "options": [{"sub_categories": ["pony"]}, {"sub_categories": ["illustrious"]}],
        "tag_groups": {"model": ["pony", "illustrious"]},
    }
    ast, notes = bind_for_wildcard("$model_variant", lambda n: "Pony", payload)
    assert notes == []
    assert matches(ast, ["pony"]) and not matches(ast, ["illustrious"])
    assert matches(ast, [])
    assert bind_for_wildcard("warm", lambda n: None, payload) == ({"tag": "warm"}, [])
    assert bind_for_wildcard(None, lambda n: None, payload) == (None, [])
    _, notes = bind_for_wildcard("$model_variant", lambda n: None, payload)
    assert notes[0]["reason"] == "unset"


def test_filter_variable_warning_says_why():
    from engine.syntax.subcat_filter import filter_variable_warning
    w = filter_variable_warning({"variable": "v", "value": "", "reason": "unset"}, module_id="m1")
    assert w["type"] == "filter_variable_no_tag" and w["severity"] == "info"
    assert w["module_id"] == "m1" and "$v is not set" in w["message"]
    note = {"variable": "v", "value": "sdxl", "reason": "no_tag"}
    w = filter_variable_warning(note, where="@{x}: ")
    assert "'sdxl'" in w["message"] and w["detail"]["reason"] == "no_tag"
