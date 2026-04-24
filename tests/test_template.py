"""Unit tests for engine.template."""

from __future__ import annotations

import pytest

from engine.template import resolve_variables


class TestResolveVariables:
    def test_basic_substitution(self):
        assert resolve_variables("$name", {"name": "Alice"}) == "Alice"

    def test_missing_var_left_as_is(self):
        assert resolve_variables("$unknown", {}) == "$unknown"

    def test_dollar_escape(self):
        assert resolve_variables("$$name", {"name": "Alice"}) == "$name"

    def test_dollar_escape_twice(self):
        assert resolve_variables("$$$$", {}) == "$$"

    def test_internal_key_never_substituted(self):
        assert resolve_variables(
            "$__seed", {"__seed": 42}
        ) == "$__seed"

    def test_mixed(self):
        ctx = {"name": "Alice", "count": 3}
        assert resolve_variables(
            "Hi $name — you have $$ $count items",
            ctx,
        ) == "Hi Alice — you have $ 3 items"

    def test_non_string_value_casts_to_str(self):
        assert resolve_variables("$n", {"n": 42}) == "42"
        assert resolve_variables("$b", {"b": True}) == "True"

    def test_word_boundary_stops_at_non_identifier(self):
        assert resolve_variables("$name.", {"name": "A"}) == "A."

    def test_adjacent_identifier_chars_extend_name(self):
        assert resolve_variables(
            "$name1", {"name": "A", "name1": "B"}
        ) == "B"

    def test_empty_template(self):
        assert resolve_variables("", {"a": "x"}) == ""

    def test_no_dollar_no_change(self):
        assert resolve_variables("plain text", {"x": "y"}) == "plain text"

    @pytest.mark.parametrize(
        ("template", "expected"),
        [
            ("$$", "$"),
            ("$$$name", "$Alice"),
            ("$name$$", "Alice$"),
        ],
    )
    def test_escape_combinations(self, template, expected):
        assert resolve_variables(template, {"name": "Alice"}) == expected
