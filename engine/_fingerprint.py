"""Per-entity-type content fingerprints. Mirror of TypeScript
`src/manager/import-export/fingerprint.ts`. Pure functions — no
DB access, no ComfyUI imports.

Cross-language contract: identical djb2 output for identical input
strings. Two pitfalls handled here that would otherwise diverge:

1. djb2 iterates UTF-16 code units (matching JS `charCodeAt`),
   not Python codepoints. Without this, any string with a non-BMP
   character (emoji, ancient scripts, etc.) hashes differently.

2. Numbers are normalised to JS-string form before serialisation.
   Python `str(1.0)` is `"1.0"` but JS `${1}` is `"1"` — they refer
   to the same number value. We coerce integer-valued floats to int
   so wildcard option weights and constraint values produce the
   same string on both sides.
"""
from __future__ import annotations

import json
from typing import Any


def _djb2(s: str) -> str:
    """djb2 hash over UTF-16 code units, returning 8 lowercase hex chars.

    Iterates UTF-16-LE bytes in pairs to match JavaScript's
    String.prototype.charCodeAt() semantics, which iterates code units
    (not codepoints). This makes Python's hash byte-identical to the
    TypeScript implementation for any Unicode string.
    """
    h = 5381
    utf16 = s.encode("utf-16-le")
    for i in range(0, len(utf16), 2):
        code_unit = utf16[i] | (utf16[i + 1] << 8)
        h = ((h * 33) ^ code_unit) & 0xFFFFFFFF
    return f"{h:08x}"


def _js_num_str(n: Any) -> str:
    """Format a number the way JavaScript's `${num}` template literal does.

    JS Number is a single type — `1` and `1.0` are identical and both
    serialise to `"1"`. Python distinguishes `int` from `float`, so we
    coerce integer-valued floats to their int representation. Booleans
    fall through to their natural Python str (since `${true}` → `"true"`
    in JS, matching `str(True).lower()`; for our use case (weights +
    constraint scalars) booleans render the same way through this path).
    """
    if isinstance(n, bool):
        return "true" if n else "false"
    if isinstance(n, float) and n.is_integer() and abs(n) < 1e16:
        return str(int(n))
    return str(n)


def _normalise_for_json(value: Any) -> Any:
    """Normalise a value so json.dumps produces JS JSON.stringify output.

    Specifically: integer-valued floats become int. Other types pass
    through unchanged. Keeps `JSON.stringify(1.0) === "1"` invariant.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e16:
        return int(value)
    return value


def wildcard_fingerprint(w: dict[str, Any]) -> str:
    """Fingerprint a wildcard entity.

    Covers: name, var_binding, options (order-sensitive), tags (order-insensitive).
    UUID is identity, not content — excluded.
    """
    name = w.get("name", "")
    var_binding = w.get("var_binding", "") or ""
    options = w.get("options") or []
    tags = w.get("tags") or []

    options_str = "|".join(
        f"{o.get('value', '')}:{_js_num_str(o.get('weight', 1))}"
        for o in options
    )
    tags_str = ",".join(sorted(tags))

    parts = [name, var_binding, options_str, tags_str]
    return _djb2("\n".join(parts))


def variable_fingerprint(v: dict[str, Any]) -> str:
    """Fingerprint a variable entity.

    Covers: name, value, tags (order-insensitive).
    UUID is identity, not content — excluded.
    """
    name = v.get("name", "")
    value = v.get("value", "")
    tags = v.get("tags") or []

    parts = [name, value, ",".join(sorted(tags))]
    return _djb2("\n".join(parts))


def constraint_fingerprint(c: dict[str, Any]) -> str:
    """Fingerprint a constraint entity.

    Covers: source_uuid, target_uuid, op, value.
    """
    source = c.get("source_uuid", "")
    target = c.get("target_uuid", "")
    op = c.get("op", "")
    value = _normalise_for_json(c.get("value", None))

    parts = [source, target, op, json.dumps(value)]
    return _djb2("\n".join(parts))
