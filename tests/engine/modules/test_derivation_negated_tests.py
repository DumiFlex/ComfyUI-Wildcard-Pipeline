"""Derivation `not_contains` / `not_matches` (schema v10, the editor's NOT toggle)."""
import pytest

from engine.modules.derivation_handler import DerivationHandler, _match_condition


@pytest.mark.parametrize("op,value,actual,want", [
    ("not_contains", "coat", "wool coat", False),
    ("not_contains", "coat", "sundress", True),
    ("not_contains", "coat", "", True),
    ("not_matches", "^wool", "wool coat", False),
    ("not_matches", "^wool", "sundress", True),
    # A broken pattern fires neither test.
    ("matches", "(", "x", False),
    ("not_matches", "(", "x", False),
])
def test_negated_tests(op, value, actual, want):
    assert _match_condition({"var": "o", "op": op, "value": value}, {"o": actual}) is want


def test_payload_with_negated_tests_validates():
    DerivationHandler.validate_payload({"rules": [{"id": "r1", "branches": [{
        "condition": {"match": "any", "conditions": [
            {"var": "o", "op": "not_contains", "value": "a"},
            {"var": "o", "op": "not_matches", "value": "b$"}]},
        "action": {"target_var": "x", "mode": "replace", "value": "y"}}]}]})
