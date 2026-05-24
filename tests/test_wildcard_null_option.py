"""validate_payload + engine rules for the null wildcard option.

A *null option* is a single optional option per wildcard, flagged
``is_null: true``, with ``value: ""`` and no ``sub_category``. When
picked it resolves to the empty string — a probabilistic
no-output slot. See docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md.
"""
from __future__ import annotations

import random

import pytest

from engine.modules.wildcard_handler import (
    WildcardHandler,
    _apply_constraint_to_options,
)


def _payload(options, sub_categories=None):
    return {
        "options": options,
        "sub_categories": list(sub_categories or []),
    }


# ── validate_payload null-option rules ────────────────────────────


def test_validate_accepts_single_null_option():
    payload = _payload([
        {"id": "aaaaaaaa", "value": "", "weight": 1, "is_null": True},
        {"id": "bbbbbbbb", "value": "red", "weight": 1, "sub_category": "warm"},
    ], sub_categories=["warm"])
    WildcardHandler.validate_payload(payload)  # no raise


def test_validate_rejects_two_null_options():
    payload = _payload([
        {"id": "aaaaaaaa", "value": "", "weight": 1, "is_null": True},
        {"id": "bbbbbbbb", "value": "", "weight": 1, "is_null": True},
    ])
    with pytest.raises(ValueError, match="at most one"):
        WildcardHandler.validate_payload(payload)


def test_validate_rejects_null_option_with_value():
    payload = _payload([
        {"id": "aaaaaaaa", "value": "oops", "weight": 1, "is_null": True},
    ])
    with pytest.raises(ValueError, match=r"null option .* value"):
        WildcardHandler.validate_payload(payload)


def test_validate_rejects_null_option_with_subcategory():
    payload = _payload([
        {"id": "aaaaaaaa", "value": "", "weight": 1,
         "is_null": True, "sub_category": "warm"},
    ], sub_categories=["warm"])
    with pytest.raises(ValueError, match=r"null option .* sub_category"):
        WildcardHandler.validate_payload(payload)


def test_validate_rejects_subcategory_named_null():
    payload = _payload([
        {"id": "aaaaaaaa", "value": "x", "weight": 1, "sub_category": "warm"},
    ], sub_categories=["null"])
    with pytest.raises(ValueError, match=r"reserved"):
        WildcardHandler.validate_payload(payload)


def test_validate_rejects_non_null_option_with_empty_value():
    """Empty values are reserved for the null option. Non-null options
    must have a non-empty string value."""
    payload = _payload([
        {"id": "aaaaaaaa", "value": "", "weight": 1},  # not flagged is_null
    ])
    with pytest.raises(ValueError, match=r"value must be a non-empty string"):
        WildcardHandler.validate_payload(payload)


# ── Nested-ref filter: `null` keyword opt-in ──────────────────────
#
# The nested ref resolver narrows the option pool to options whose
# sub_category is in the filter list. The null option has no
# sub_category, so it's dropped by default. Adding the reserved keyword
# `null` to the filter opts it in. Tested via a parent wildcard whose
# option value contains the `@{target:filter}` ref — exercises the same
# resolve_text path the SPA + engine use at runtime.


def _resolve_parent_with_ref(parent_value: str, target_uuid: str, target_options, seed=0):
    """Helper: build a tiny catalog with a parent wildcard whose single
    option's value is the supplied template (typically `@{target:...}`).
    Resolves once with a deterministic RNG and returns the bound output."""
    ctx = {
        "__wp_rng__": random.Random(seed),
        "__wp_warnings__": [],
        "__wp_catalog__": {
            target_uuid: {
                "type": "wildcard",
                "var_binding": "_tgt",
                "options": target_options,
            },
        },
    }
    payload = _payload([{"id": "p1", "value": parent_value, "weight": 1}])
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$out"}, ctx=ctx,
    )
    return out, ctx


def test_nested_ref_filter_default_keeps_null_option():
    """Inverted null semantic (2026-05-25): `@{uuid:warm}` keeps warm
    options AND the null option. Heavy weight on null ⇒ null wins, so
    the bound output is the empty string."""
    target_opts = [
        {"id": "n", "value": "", "weight": 999, "is_null": True},
        {"id": "r", "value": "red", "weight": 1, "sub_category": "warm"},
    ]
    out, _ = _resolve_parent_with_ref("@{aabbccdd:warm}", "aabbccdd", target_opts)
    assert out == {"$out": ""}


def test_nested_ref_filter_with_null_keyword_excludes_null():
    """`@{uuid:warm,null}` keeps warm options and EXCLUDES the null
    option — the reserved `null` keyword is a negation."""
    target_opts = [
        {"id": "n", "value": "", "weight": 999, "is_null": True},
        {"id": "r", "value": "red", "weight": 1, "sub_category": "warm"},
    ]
    out, _ = _resolve_parent_with_ref("@{aabbccdd:warm,null}", "aabbccdd", target_opts)
    # Null is excluded → only "red" remains regardless of its tiny weight.
    assert out == {"$out": "red"}


def test_nested_ref_filter_null_only_excludes_null():
    """`@{uuid:null}` with no other sub-cats means "exclude null, no
    sub-cat filter" — all non-null options pass."""
    target_opts = [
        {"id": "n", "value": "", "weight": 1, "is_null": True},
        {"id": "r", "value": "red", "weight": 999, "sub_category": "warm"},
    ]
    out, _ = _resolve_parent_with_ref("@{aabbccdd:null}", "aabbccdd", target_opts)
    assert out == {"$out": "red"}


# ── Constraint integration ───────────────────────────────────────


def test_null_option_bypasses_matrix_exclude():
    """Matrix excludes sub_cat='warm' but null option has no sub_cat
    and survives at full weight."""
    options = [
        {"id": "n", "value": "", "weight": 2, "is_null": True},
        {"id": "r", "value": "red", "weight": 1, "sub_category": "warm"},
    ]
    constraint = {
        "matrix": {"src_sub": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
    }
    src_pick = {"value": "anything", "sub_category": "src_sub"}
    out = _apply_constraint_to_options(options, constraint, src_pick)
    weights = {o["id"]: o["weight"] for o in out}
    assert weights["n"] == 2, "null option weight should be untouched"
    assert weights["r"] == 0, "warm option should be excluded"


def test_null_option_matched_by_exception():
    """Exception with target=='' matches the null option's value=''
    and excludes it explicitly. Confirms the existing exception lookup
    layer keys correctly on the empty-string value the null option emits.
    """
    options = [
        {"id": "n", "value": "", "weight": 5, "is_null": True},
        {"id": "r", "value": "red", "weight": 1, "sub_category": "warm"},
    ]
    constraint = {
        "matrix": {},
        "exceptions": [
            {"source": "rain", "target": "", "mode": "exclude", "factor": 1},
        ],
    }
    src_pick = {"value": "rain", "sub_category": "wet"}
    out = _apply_constraint_to_options(options, constraint, src_pick)
    weights = {o["id"]: o["weight"] for o in out}
    assert weights["n"] == 0, "null option should be excluded by exception"
    assert weights["r"] == 1, "non-matched option untouched"
