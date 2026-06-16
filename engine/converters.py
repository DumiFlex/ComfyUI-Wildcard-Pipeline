"""Pure-Python parsers for the WP_VarTo* converter nodes.

Each function:
- Never raises. Unparseable input or out-of-range index returns `default`.
- Has a TS mirror in `src/components/var-picker/parser.ts`. The two copies
  share a fixture (`tests/fixtures/converter_cases.json`) consumed by a
  parity test (`tests/test_parser_parity.py` + `parser.test.ts`).
"""

import re
from typing import Protocol

from engine.syntax.types import deref_var_value, split_var_accessor


class _CtxLike(Protocol):
    context: dict[str, object]


_INT_RE = re.compile(r"-?\d+")
_FLOAT_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
_BOOL_SPLIT_RE = re.compile(r"[\s,;|/]+")
_TRUTHY: frozenset[str] = frozenset({"true", "yes", "on", "1"})
_FALSY: frozenset[str] = frozenset({"false", "no", "off", "0"})


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


def parse_bool(text: str, index: int, default: bool) -> bool:
    """Return the Nth bool token from `text`, or `default`.

    Tokens are produced by splitting on `[\\s,;|/]+`. Each token is
    matched case-insensitively against the truthy/falsy sets. Tokens
    that match neither (e.g. `"1.5"`, `"enabled"`) are skipped — they
    don't consume an index slot.
    """
    if not text:
        return default
    tokens = _BOOL_SPLIT_RE.split(text)
    bools: list[bool] = []
    for tok in tokens:
        low = tok.lower()
        if low in _TRUTHY:
            bools.append(True)
        elif low in _FALSY:
            bools.append(False)
    if index < 0 or index >= len(bools):
        return default
    return bools[index]


def lookup_var(context: _CtxLike, name: str) -> str:
    """Read `name` from `context.context`. Strips leading `$`. Never raises.

    Missing key, `None`, or empty name all collapse to `""` — every parser
    then falls back to its `default`.
    """
    bare = (name or "").lstrip("$").strip()
    if not bare:
        return ""
    base, index = split_var_accessor(bare)
    raw = context.context.get(base) if context and getattr(context, "context", None) else None
    return deref_var_value(raw, index)
