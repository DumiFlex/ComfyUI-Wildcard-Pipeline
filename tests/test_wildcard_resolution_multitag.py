"""SP1 multi-tag pool filtering — `_apply_pool_filter` (shared matcher).

Covers the §3.4 matching semantics applied to the instance
`category_filter` site (the nested `@{}` site shares the same matcher
via engine/syntax/resolve.py).
"""
from engine.modules.wildcard_handler import WildcardHandler

_apply = WildcardHandler._apply_pool_filter


def _opts():
    return [
        {"id": "a", "value": "crimson", "weight": 1, "sub_categories": ["red", "warm"]},
        {"id": "b", "value": "navy", "weight": 1, "sub_categories": ["blue", "cold"]},
    ]


def _ids(options):
    return {o["id"] for o in options}


def test_any_match_single_tag():
    assert [o["id"] for o in _apply(_opts(), "warm", exclude_null=False)] == ["a"]


def test_boolean_or():
    assert _ids(_apply(_opts(), "warm or cold", exclude_null=False)) == {"a", "b"}


def test_boolean_and():
    assert _ids(_apply(_opts(), "red and warm", exclude_null=False)) == {"a"}
    assert _ids(_apply(_opts(), "red and cold", exclude_null=False)) == set()


def test_not():
    assert _ids(_apply(_opts(), "not cold", exclude_null=False)) == {"a"}


def test_empty_expr_keeps_all():
    assert len(_apply(_opts(), "", exclude_null=False)) == 2


def test_null_option_governed_by_exclude_null():
    opts = _opts() + [
        {"id": "n", "value": "", "weight": 1, "is_null": True, "sub_categories": []},
    ]
    # null survives a tag filter when exclude_null is false…
    assert "n" in _ids(_apply(opts, "warm", exclude_null=False))
    # …and is dropped when exclude_null is true.
    assert "n" not in _ids(_apply(opts, "warm", exclude_null=True))
    # exclude_null with empty expr still drops only the null option.
    kept = _apply(opts, "", exclude_null=True)
    assert _ids(kept) == {"a", "b"}


def test_untagged_option_bypass_semantics():
    opts = [{"id": "u", "value": "x", "weight": 1, "sub_categories": []}]
    # A bare tag term excludes an untagged option…
    assert _apply(opts, "warm", exclude_null=False) == []
    # …but `not <tag>` keeps it ("doesn't have warm").
    assert [o["id"] for o in _apply(opts, "not warm", exclude_null=False)] == ["u"]
