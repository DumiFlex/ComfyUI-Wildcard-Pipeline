"""Pure-Python parsers for the WP_VarTo* converter nodes.

Each function:
- Never raises. Unparseable input or out-of-range index returns `default`.
- Has a TS mirror in `src/components/var-picker/parser.ts`. The two copies
  share a fixture (`tests/fixtures/converter_cases.json`) consumed by a
  parity test (`tests/test_parser_parity.py` + `parser.test.ts`).
"""

import re

_INT_RE = re.compile(r"-?\d+")
_FLOAT_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")


def parse_int(text: str, index: int, default: int) -> int:
    """Return the Nth signed-integer match from `text`, or `default`."""
    matches = _INT_RE.findall(text or "")
    if index < 0 or index >= len(matches):
        return default
    try:
        return int(matches[index])
    except ValueError:
        return default


def parse_float(text: str, index: int, default: float) -> float:
    """Return the Nth signed-float match from `text`, or `default`.

    Matches integers too (no required decimal) so a var of `"1920"` still
    yields `1920.0`. Scientific notation supported (`3.2e-4`).
    """
    matches = _FLOAT_RE.findall(text or "")
    if index < 0 or index >= len(matches):
        return default
    try:
        return float(matches[index])
    except ValueError:
        return default
