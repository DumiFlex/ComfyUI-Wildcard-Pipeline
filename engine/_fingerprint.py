"""Module content fingerprint. Mirror of TypeScript
`src/manager/import-export/fingerprint.ts:moduleFingerprint`.

Single unified helper for all 5 module types. Hashes
[type, name, description, sorted_tags_csv, payload_hash] joined by '\\n'.

Pure function — no DB access, no ComfyUI imports.

Cross-language contract: identical djb2 output for identical input
strings. djb2 iterates UTF-16 code units (matching JS `charCodeAt`)
so any string — including non-BMP characters like emoji — hashes
identically on both sides.
"""
from __future__ import annotations

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


def module_fingerprint(m: dict[str, Any]) -> str:
    """Content fingerprint of a module row.

    Reads keys: type, name, description, tags (list[str]), payload_hash.
    Other keys (id, category_id, is_favorite, version, etc.) are ignored
    by design — they are not content.
    """
    parts = [
        m.get("type", ""),
        m.get("name", ""),
        m.get("description", ""),
        ",".join(sorted(m.get("tags") or [])),
        m.get("payload_hash", ""),
    ]
    return _djb2("\n".join(parts))
