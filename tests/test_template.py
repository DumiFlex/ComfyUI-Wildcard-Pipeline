"""Unit tests for engine.template."""

from __future__ import annotations

import random

import pytest

from engine.template import resolve_variables


def _ctx(**kwargs):
    """Return a minimal ctx dict with required engine keys + extra kwargs."""
    return {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        **kwargs,
    }


class TestResolveVariables:
    def test_basic_substitution(self):
        assert resolve_variables("$name", _ctx(name="Alice")) == "Alice"

    def test_missing_var_dropped(self):
        # Missing vars resolve to empty string so the prompt sent to the
        # model never contains literal "$unknown" tokens.
        assert resolve_variables("$unknown", _ctx()) == ""

    def test_missing_var_collapses_surrounding_whitespace(self):
        assert resolve_variables("a $missing b", _ctx()) == "a b"

    def test_missing_var_collapses_comma_gap(self):
        assert resolve_variables("photo, $missing, cinematic", _ctx()) == "photo, cinematic"

    def test_missing_var_trims_trailing_punct(self):
        assert resolve_variables("portrait of $subject.", _ctx()) == "portrait of."

    def test_dollar_escape(self):
        assert resolve_variables("$$name", _ctx(name="Alice")) == "$name"

    def test_dollar_escape_twice(self):
        assert resolve_variables("$$$$", _ctx()) == "$$"

    def test_internal_key_never_substituted(self):
        # Phase 5: internal keys ($__seed) resolve to "" (not literal "$__seed").
        # The old ad-hoc regex kept them verbatim; resolve_text drops them silently.
        # Callers must never embed internal keys in templates — this is engine policy.
        assert resolve_variables("$__seed", _ctx()) == ""

    def test_mixed(self):
        ctx = _ctx(name="Alice", count=3)
        assert resolve_variables(
            "Hi $name — you have $$ $count items",
            ctx,
        ) == "Hi Alice — you have $ 3 items"

    def test_non_string_value_casts_to_str(self):
        assert resolve_variables("$n", _ctx(n=42)) == "42"
        assert resolve_variables("$b", _ctx(b=True)) == "True"

    def test_word_boundary_stops_at_non_identifier(self):
        assert resolve_variables("$name.", _ctx(name="A")) == "A."

    def test_adjacent_identifier_chars_extend_name(self):
        assert resolve_variables(
            "$name1", _ctx(name="A", name1="B")
        ) == "B"

    def test_empty_template(self):
        assert resolve_variables("", _ctx(a="x")) == ""

    def test_no_dollar_no_change(self):
        assert resolve_variables("plain text", _ctx(x="y")) == "plain text"

    @pytest.mark.parametrize(
        ("template", "expected"),
        [
            ("$$", "$"),
            ("$$$name", "$Alice"),
            ("$name$$", "Alice$"),
        ],
    )
    def test_escape_combinations(self, template, expected):
        assert resolve_variables(template, _ctx(name="Alice")) == expected


def test_resolve_variables_leaves_inline_pick_literal_on_assembler():
    # The assembler surface is seedless (always rolls from seed 0), so an
    # inline pick there would freeze deterministically — misleading. Engine
    # policy: render `{a|b}` verbatim and let the user produce the random
    # value in a seeded module, referencing its $var. $var substitution
    # still happens, so only the brace block stays literal.
    ctx = {"__wp_rng__": random.Random(42), "__wp_warnings__": [], "color": "red"}
    out = resolve_variables("$color {a|b}", ctx)
    assert out == "red {a|b}"


def test_resolve_variables_leaves_multi_pick_literal_on_assembler():
    # Same rule for the multi-pick `{N$$sep$$...}` form.
    ctx = {"__wp_rng__": random.Random(42), "__wp_warnings__": []}
    assert resolve_variables("{2$$, $$a|b|c}", ctx) == "{2$$, $$a|b|c}"


def test_resolve_variables_legacy_dollar_var_unchanged():
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "style": "anime",
        "subject": "girl",
    }
    assert resolve_variables("a $style $subject", ctx) == "a anime girl"
