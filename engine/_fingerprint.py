"""Per-entity-type content fingerprints. Mirror of TypeScript
`src/manager/import-export/fingerprint.ts`. Pure functions — no
DB access, no ComfyUI imports.

Cross-language contract: identical djb2 output for identical input
strings. Keep input string construction byte-identical between sides.
"""
from __future__ import annotations

import json
from typing import Any


def _djb2(s: str) -> str:
    """djb2 hash → 8 hex chars. Small, order-sensitive, collision rate
    acceptable for content fingerprinting. Not cryptographic; we only
    need inequality to surface a diff.

    Matches TypeScript implementation exactly:
    - Initial seed: 5381
    - Chain: h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    - Format: 8-digit hex with zero-padding
    """
    h = 5381
    for ch in s:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return f"{h:08x}"


def wildcard_fingerprint(w: dict[str, Any]) -> str:
    """Fingerprint a wildcard entity.

    Covers: name, var_binding, options (order-sensitive), tags (order-insensitive).
    UUID is identity, not content — excluded.
    """
    name = w.get("name", "")
    var_binding = w.get("var_binding", "") or ""
    options = w.get("options") or []
    tags = w.get("tags") or []

    options_str = "|".join(f"{o.get('value', '')}:{o.get('weight', 1)}" for o in options)
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
    value = c.get("value", None)

    parts = [source, target, op, json.dumps(value)]
    return _djb2("\n".join(parts))
