"""Composite-key encoder. Mirrors JS `encodeKey` byte-for-byte.

Spec invariant: composite keys are JSON-encoded string arrays, no
whitespace, unicode literal (not escaped), array order preserved.
Cross-language fitness test in `tests/test_engine_keys.py` enforces
byte-exact match.

See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §4.5
"""
import json


def encode_key(parts: list[str]) -> str:
    return json.dumps(parts, separators=(",", ":"), ensure_ascii=False)


def decode_key(key: str) -> list[str]:
    """Inverse of encode_key. Round-trip safe by spec invariant.

    Raises ValueError on malformed input — caller should treat unknown
    keys as "skip silently" rather than crash the resolve.
    """
    parts = json.loads(key)
    if not isinstance(parts, list) or not all(isinstance(p, str) for p in parts):
        raise ValueError(f"composite key must decode to list[str], got {parts!r}")
    return parts
