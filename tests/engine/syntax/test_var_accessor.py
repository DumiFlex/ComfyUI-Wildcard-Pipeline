"""`$name` accessor grammar: at most one pick index and one axis, either order.

Both orders name the same value. Accepting both is deliberate — `$outfit.0` is
already a meaningful thing on its own, so a user who wants that pick's shoe will
reach for `$outfit.0.SHOES`, and rejecting it would make the natural spelling
the broken one. The tokenizer normalises to one shape immediately, so nothing
downstream learns which spelling was written.
"""
import pytest

from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind, parse_var_reference


def _var_meta(text):
    toks = [t for t in tokenize_text(text) if t.kind is TokenKind.VAR]
    return toks[0].meta if toks else None


@pytest.mark.parametrize("text,expected", [
    ("$outfit", {"name": "outfit"}),
    ("$outfit.0", {"name": "outfit", "index": 0}),
    ("$outfit.SHOES", {"name": "outfit", "axis": "SHOES"}),
    ("$outfit.0.SHOES", {"name": "outfit", "index": 0, "axis": "SHOES"}),
    ("$outfit.SHOES.0", {"name": "outfit", "axis": "SHOES", "index": 0}),
])
def test_accepted_forms(text, expected):
    assert _var_meta(text) == expected


def test_both_orders_parse_identically():
    assert _var_meta("$outfit.0.SHOES") == _var_meta("$outfit.SHOES.0")


@pytest.mark.parametrize("text", ["$outfit.0.1", "$outfit.SHOES.BELTS"])
def test_nonsense_forms_do_not_get_both_accessors(text):
    """Two indices or two axes is not a reference. The grammar rejects it by
    not matching the second segment, so the tail stays literal text rather than
    being silently absorbed."""
    meta = _var_meta(text)
    assert meta is not None
    assert not ("axis" in meta and "index" in meta)


@pytest.mark.parametrize("raw,expected", [
    ("outfit", ("outfit", None, None)),
    ("outfit.0", ("outfit", 0, None)),
    ("outfit.SHOES", ("outfit", None, "SHOES")),
    ("outfit.0.SHOES", ("outfit", 0, "SHOES")),
    ("outfit.SHOES.0", ("outfit", 0, "SHOES")),
])
def test_string_path_parser(raw, expected):
    assert parse_var_reference(raw) == expected


@pytest.mark.parametrize("raw", ["outfit.0.1", "outfit.SHOES.BELTS", "1bad"])
def test_string_path_parser_passes_junk_through_whole(raw):
    """An unparseable name is returned intact with no accessors, so an unusual
    ctx key still resolves as itself rather than being truncated."""
    assert parse_var_reference(raw) == (raw, None, None)
