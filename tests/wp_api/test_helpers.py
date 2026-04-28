"""extract_referenced_uuids — used by Test Runner to collect lazy-walk
roots from incoming request bodies. Walks the whole nested structure
because requests can put @{uuid} refs inside payload, instance overrides,
or any other text-bearing field."""
from __future__ import annotations

from wp_api._helpers import extract_referenced_uuids


def test_finds_refs_in_nested_string_values():
    body = {
        "type": "wildcard",
        "payload": {
            "options": [
                {"value": "red @{aabbccdd} thing", "weight": 1},
                {"value": "no ref here", "weight": 1},
            ],
        },
        "instance": {"variable_binding": "color"},
    }
    assert extract_referenced_uuids(body) == {"aabbccdd"}


def test_finds_multiple_refs_dedups():
    body = {"v": "@{aaaaaaaa} and @{bbbbbbbb} and @{aaaaaaaa} again"}
    assert extract_referenced_uuids(body) == {"aaaaaaaa", "bbbbbbbb"}


def test_ignores_text_that_is_not_a_valid_ref():
    body = {"v": "@{not-hex} @{toolong12345} @{TOOSHORT}"}
    assert extract_referenced_uuids(body) == set()


def test_empty_or_missing_payload_returns_empty_set():
    assert extract_referenced_uuids({}) == set()
    assert extract_referenced_uuids({"payload": None}) == set()
