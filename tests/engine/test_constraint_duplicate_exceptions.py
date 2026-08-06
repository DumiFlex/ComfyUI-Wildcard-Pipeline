"""Duplicate `(source, target)` exception pairs are rejected when authoring.

Reported 2026-08-06: the editor accepted the same source/target combination
more than once with contradictory modes and factors. Only one can ever apply —
`combine_constraint_factor` files exceptions into a dict keyed by the pair, so
the last one in the list wins and the rest vanish. Including, in the worst
case, an `exclude` the user deliberately set.
"""
from __future__ import annotations

import pytest

from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor
from engine.modules.constraint_handler import (
    ConstraintHandler,
    find_duplicate_exception_pairs,
)


def _exc(
    source: str, target: str, mode: str, factor: float = 1,
) -> dict[str, object]:
    return {"source": source, "target": target, "mode": mode, "factor": factor}


def _payload(exceptions):
    return {
        "source_wildcard_id": "aaaaaaaa",
        "target_wildcard_id": "bbbbbbbb",
        "matrix": {},
        "exceptions": exceptions,
    }


class TestTheUnderlyingBehaviour:
    """Pins WHY duplicates are rejected, so the reason survives the rule."""

    def _factor(self, exceptions):
        picks = [{"value": "rain", "tags": []}]
        option = {"value": "sandals", "tags": []}
        return combine_constraint_factor(picks, option, {}, exceptions)

    def test_last_duplicate_wins_so_order_decides_the_outcome(self):
        boost = _exc("rain", "sandals", "boost", 3)
        reduce_ = _exc("rain", "sandals", "reduce", 0.5)
        assert self._factor([boost, reduce_]) == 0.5
        assert self._factor([reduce_, boost]) == 3.0
        # Not the combined 1.5 either way — one rule is simply discarded.

    def test_a_later_duplicate_can_silently_defeat_an_exclude(self):
        exclude = _exc("rain", "sandals", "exclude")
        boost = _exc("rain", "sandals", "boost", 3)
        assert self._factor([boost, exclude]) is EXCLUDE
        # The alarming direction: the exclusion is thrown away entirely.
        assert self._factor([exclude, boost]) == 3.0


class TestDuplicateDetection:
    def test_reports_the_repeated_pair_once_in_first_seen_order(self):
        payload = _payload([
            _exc("a", "x", "boost", 2),
            _exc("b", "y", "reduce", 0.5),
            _exc("a", "x", "exclude"),
            _exc("a", "x", "allow"),
        ])
        assert find_duplicate_exception_pairs(payload) == [("a", "x")]

    def test_distinct_pairs_are_not_duplicates(self):
        payload = _payload([
            _exc("a", "x", "boost", 2),
            _exc("a", "y", "boost", 2),
            _exc("b", "x", "boost", 2),
        ])
        assert find_duplicate_exception_pairs(payload) == []

    def test_tier2_and_legacy_key_names_describe_the_same_pair(self):
        """`source_value` and `source` are the same field to the engine, so a
        payload mixing both must not smuggle a duplicate past the check."""
        payload = _payload([
            {"source_value": "a", "target_value": "x", "mode": "boost", "factor": 2},
            {"source": "a", "target": "x", "mode": "exclude", "factor": 1},
        ])
        assert find_duplicate_exception_pairs(payload) == [("a", "x")]

    def test_the_null_option_pair_is_a_real_pair(self):
        """Empty string is the null-option marker, not missing data."""
        payload = _payload([
            _exc("", "x", "boost", 2),
            _exc("", "x", "reduce", 0.5),
        ])
        assert find_duplicate_exception_pairs(payload) == [("", "x")]


class TestAuthoringValidation:
    def test_duplicates_are_rejected_with_both_values_named(self):
        payload = _payload([
            _exc("rain", "sandals", "exclude"),
            _exc("rain", "sandals", "boost", 3),
        ])
        with pytest.raises(ValueError) as err:
            ConstraintHandler.validate_authoring(payload)
        message = str(err.value)
        assert "rain" in message and "sandals" in message

    def test_a_clean_payload_passes(self):
        payload = _payload([
            _exc("rain", "sandals", "exclude"),
            _exc("sun", "sandals", "boost", 3),
        ])
        ConstraintHandler.validate_authoring(payload)

    def test_execution_time_validation_still_accepts_duplicates(self):
        """The rule lives at the authoring boundary ON PURPOSE.

        `resolve` calls `validate_payload` on every graph run. Rejecting there
        would turn an already-stored payload into a hard failure mid-execution
        — worse than the silent misbehaviour it replaces, and unreachable for
        a user who cannot open the editor without the graph running.

        So `validate_payload` must keep accepting what is already in the
        database; only saving and importing get stricter.
        """
        payload = _payload([
            _exc("rain", "sandals", "exclude"),
            _exc("rain", "sandals", "boost", 3),
        ])
        ConstraintHandler.validate_payload(payload)  # must not raise
