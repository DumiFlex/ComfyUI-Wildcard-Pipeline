"""Validation tests for WildcardHandler.validate_payload — option.id required."""
import pytest

from engine.modules.wildcard_handler import WildcardHandler


def test_option_without_id_raises():
    payload = {
        "sub_categories": [],
        "options": [
            {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
        ],
    }
    with pytest.raises(ValueError, match=r"options\[0\]\.id must be a string"):
        WildcardHandler.validate_payload(payload)


def test_option_with_id_passes():
    payload = {
        "sub_categories": [],
        "options": [
            {
                "id": "a1b2c3d4",
                "value": "buzz",
                "weight": 1,
                "sub_category": None,
                "probability": 1.0,
            }
        ],
    }
    WildcardHandler.validate_payload(payload)  # raises nothing
