"""Snapshot freezing, content hashing, and legacy-shape coercion.

A *snapshot* is the JSON shape embedded in a ComfyUI workflow's WP_Context
node when a user picks a library row. The snapshot is decoupled from the
library: graph execution reads only the snapshot, never the live DB.

Backward-compat: pre-SPA fixed_values modules in saved workflows lack the
``library_*`` and ``instance`` keys. ``coerce_legacy_module`` upgrades them
in-place to the canonical shape (still detached, ``library_id is None``).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
from typing import Any


def _now_iso() -> str:
    """UTC ISO timestamp with millisecond precision and ``Z`` suffix."""
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _fresh_instance() -> dict[str, Any]:
    """Default per-snapshot instance overrides. Fresh dict per call."""
    return {
        "variable_binding": "",
        "enabled_options": None,
        "category_filter": None,
    }


def payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 of canonical JSON. Stable across key order + whitespace."""
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def freeze_snapshot(library_row: dict[str, Any]) -> dict[str, Any]:
    """Build the JSON shape that gets embedded in a node's modules array."""
    return {
        "library_id": library_row["id"],
        "library_snapshot_at": _now_iso(),
        "library_version_at_snapshot": library_row["version"],
        "type": library_row["type"],
        "name": library_row["name"],
        "category_id": library_row.get("category_id"),
        "payload": library_row["payload"],
        "instance": _fresh_instance(),
    }


def coerce_legacy_module(raw: dict[str, Any]) -> dict[str, Any]:
    """Upgrade a legacy module dict to canonical snapshot shape.

    Idempotent: returns ``raw`` unchanged if it already has both
    ``library_id`` and ``instance`` keys.
    """
    if "instance" in raw and "library_id" in raw:
        return raw

    payload: dict[str, Any]
    if raw.get("type") == "fixed_values" and "entries" in raw:
        legacy_entries = raw.get("entries", [])
        payload = {
            "values": [
                {
                    "id": f"val_{i:04x}",
                    "name": e.get("variable_name", ""),
                    "value": e.get("value", ""),
                }
                for i, e in enumerate(legacy_entries)
            ],
        }
    else:
        payload = raw.get("payload", {})

    meta = raw.get("meta") or {}
    return {
        "library_id": raw.get("library_id"),
        "library_snapshot_at": raw.get("library_snapshot_at"),
        "library_version_at_snapshot": raw.get("library_version_at_snapshot"),
        "type": raw.get("type", "fixed_values"),
        "name": raw.get("name") or meta.get("name", ""),
        "category_id": raw.get("category_id"),
        "payload": payload,
        "instance": _fresh_instance(),
    }
