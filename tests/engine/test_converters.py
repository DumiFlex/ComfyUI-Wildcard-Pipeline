"""Pure-Python parser tests for engine/converters.py.

Each parser is tested independently. A separate parity test
(`tests/test_parser_parity.py`) reads the same input/expected pairs
from `tests/fixtures/converter_cases.json` and asserts the TS mirror
agrees — keeps the two implementations from drifting.
"""

import pytest

from engine.converters import lookup_var, parse_bool, parse_float, parse_int


class _StubCtx:
    """Mimics the ContextPayload shape — only `.context` is read."""

    def __init__(self, ctx):
        self.context = ctx


@pytest.mark.parametrize(
    "text,index,default,expected",
    [
        ("1920x1080", 0, -1, 1920),
        ("1920x1080", 1, -1, 1080),
        ("1920x1080", 2, -1, -1),
        ("hello", 0, -1, -1),
        ("temp -5C", 0, 0, -5),
        ("", 0, 7, 7),
        ("0 1 2 3", 2, -1, 2),
        ("v3.2.1 build 4096", 3, -1, 4096),
    ],
)
def test_parse_int(text, index, default, expected):
    assert parse_int(text, index, default) == expected


@pytest.mark.parametrize(
    "text,index,default,expected",
    [
        ("strength: 0.85, scale: 1.5", 0, 0.0, 0.85),
        ("strength: 0.85, scale: 1.5", 1, 0.0, 1.5),
        ("1920", 0, 0.0, 1920.0),
        ("none", 0, 1.0, 1.0),
        ("3.2e-4", 0, 0.0, 0.00032),
        ("-1.5 +2.0", 0, 0.0, -1.5),
        ("", 0, 0.5, 0.5),
        ("v1.0.0", 2, -1.0, -1.0),
    ],
)
def test_parse_float(text, index, default, expected):
    assert parse_float(text, index, default) == pytest.approx(expected)


@pytest.mark.parametrize(
    "text,index,default,expected",
    [
        ("true false true", 2, False, True),
        ("yes,no,yes", 1, True, False),
        ("1 0 1", 0, False, True),
        ("1.5", 0, False, False),  # 1.5 is NOT a bool token
        ("enabled disabled", 0, True, True),  # neither token matches → default
        ("on off ON OFF", 3, False, False),  # case-insensitive
        ("", 0, True, True),
        ("yes|no/on;off", 3, True, False),  # multi-separator split
    ],
)
def test_parse_bool(text, index, default, expected):
    assert parse_bool(text, index, default) is expected


def test_lookup_var_joins_and_indexes_listvar():
    """SP2a: a ListVar var read by the WP_VarTo* nodes joins (bare $c) or
    indexes (`$c.K`) instead of stringifying the dataclass repr (which fed
    stray digits into parse_int/parse_float)."""
    from engine.syntax.types import ListVar

    ctx = _StubCtx({"c": ListVar(["red", "blue"], ", ")})
    assert lookup_var(ctx, "$c") == "red, blue"
    assert lookup_var(ctx, "c.0") == "red"
    assert lookup_var(ctx, "$c.1") == "blue"
    assert lookup_var(ctx, "c.9") == ""  # out of range -> ""


@pytest.mark.parametrize(
    "ctx,name,expected",
    [
        ({"seed": "1920"}, "$seed", "1920"),
        ({"seed": "1920"}, "seed", "1920"),  # bare name accepted
        ({"seed": "1920"}, "$$seed", "1920"),  # multiple $ stripped
        ({"seed": 42}, "$seed", "42"),  # int coerced to str
        ({}, "$missing", ""),  # missing → empty
        ({"x": None}, "$x", ""),  # None → empty
        ({}, "", ""),  # empty name → empty
    ],
)
def test_lookup_var(ctx, name, expected):
    assert lookup_var(_StubCtx(ctx), name) == expected
