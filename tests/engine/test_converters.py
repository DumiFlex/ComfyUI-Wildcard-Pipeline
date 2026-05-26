"""Pure-Python parser tests for engine/converters.py.

Each parser is tested independently. A separate parity test
(`tests/test_parser_parity.py`) reads the same input/expected pairs
from `tests/fixtures/converter_cases.json` and asserts the TS mirror
agrees — keeps the two implementations from drifting.
"""

import pytest

from engine.converters import parse_int


@pytest.mark.parametrize(
    "text,index,default,expected",
    [
        ("1920x1080", 0, -1, 1920),
        ("1920x1080", 1, -1, 1080),
        ("1920x1080", 2, -1, -1),
        ("hello", 0, -1, -1),
        ("temp -5C", 0, 0, -5),
        ("", 0, 7, 7),
        ("0 1 2 3", 2, -1, 2),
        ("v3.2.1 build 4096", 3, -1, 4096),
    ],
)
def test_parse_int(text, index, default, expected):
    assert parse_int(text, index, default) == expected
