"""Drift guard: assert every case in `converter_cases.json` matches
the Python parser output. The TS side runs the same fixture in
`src/components/var-picker/parser.test.ts`. A divergence between the
two parsers fails one of the two suites.
"""

import json
from pathlib import Path

import pytest

from engine.converters import parse_bool, parse_float, parse_int

_FIXTURE = Path(__file__).parent / "fixtures" / "converter_cases.json"
_DATA = json.loads(_FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _DATA["parse_int"])
def test_parity_parse_int(case):
    assert parse_int(case["text"], case["index"], case["default"]) == case["expected"]


@pytest.mark.parametrize("case", _DATA["parse_float"])
def test_parity_parse_float(case):
    got = parse_float(case["text"], case["index"], case["default"])
    assert got == pytest.approx(case["expected"])


@pytest.mark.parametrize("case", _DATA["parse_bool"])
def test_parity_parse_bool(case):
    assert parse_bool(case["text"], case["index"], case["default"]) is case["expected"]
