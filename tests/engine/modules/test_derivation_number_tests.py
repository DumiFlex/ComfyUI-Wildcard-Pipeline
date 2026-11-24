"""Derivation `is_above` / `is_below` (schema v13, the number tests for `.num`)."""
import pytest

from engine.modules.derivation_handler import DerivationHandler, _match_condition


@pytest.mark.parametrize("op,value,actual,want", [
    ("is_above", "0.5", "0.75", True),
    ("is_above", "0.5", "0.5", False),
    ("is_above", "-1", "0", True),
    ("is_below", "10", "9.99", True),
    ("is_below", "10", "10", False),
    ("is_below", ".5", " 0.25 ", True),
    # Text on either side never passes, nor do forms the TS preview can't read.
    ("is_above", "0.5", "high", False),
    ("is_below", "low", "0.2", False),
    ("is_above", "0", "", False),
    ("is_above", "1e-3", "0.2", False),
    ("is_above", "0", "inf", False),
    ("is_below", "1", "nan", False),
])
def test_number_tests(op, value, actual, want):
    assert _match_condition({"var": "o", "op": op, "value": value}, {"o": actual}) is want


def test_missing_variable_never_passes():
    assert _match_condition({"var": "o", "op": "is_below", "value": "5"}, {}) is False


def test_payload_with_number_tests_validates():
    DerivationHandler.validate_payload({"rules": [{"id": "r1", "branches": [{
        "condition": {"match": "any", "conditions": [
            {"var": "detail.num", "op": "is_above", "value": "0.5"},
            {"var": "o", "op": "is_below", "value": "2"}]},
        "action": {"target_var": "x", "mode": "replace", "value": "y"}}]}]})
