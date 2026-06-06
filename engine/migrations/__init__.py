"""Versioned payload migration chain. Mirror of TypeScript
`src/manager/import-export/migrations.ts`.

Used by `engine/importer.py` on server-side parse paths (re-validate
on commit). Client-side migration is the source of truth for what
the user saw in the picker; server re-runs as defense in depth.
"""
from __future__ import annotations

from typing import Any

from engine.migrations.v0_to_v1 import migrate_v0_to_v1
from engine.migrations.v1_to_v2 import migrate_v1_to_v2

CURRENT_SCHEMA_VERSION = 2

_CHAIN = {
    0: migrate_v0_to_v1,
    1: migrate_v1_to_v2,
}


def migrate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Walk the migration chain from `payload.schema_version` up to current.

    Returns one of:
    - {"ok": True, "migrated": <dict>, "migrated_entity_count": int}
      where migrated_entity_count is the cumulative entity count across
      all migration steps (total bundles+wildcards+fixed_values+combines+
      derivations+constraints+categories that passed through any step).
      Matches TS `migratedEntityCount`.
    - {"ok": False, "reason": str}
    """
    version = payload.get("schema_version")
    if not isinstance(version, int):
        return {"ok": False, "reason": "payload missing schema_version field"}
    if version > CURRENT_SCHEMA_VERSION:
        return {
            "ok": False,
            "reason": f"future schema version {version} (current: {CURRENT_SCHEMA_VERSION})",
        }
    current = {
        "schema_version": version,
        "bundles": payload.get("bundles", []),
        "wildcards": payload.get("wildcards", []),
        "fixed_values": payload.get("fixed_values", []),
        "combines": payload.get("combines", []),
        "derivations": payload.get("derivations", []),
        "constraints": payload.get("constraints", []),
        "categories": payload.get("categories", []),
    }
    migrated_entity_count = 0
    while current["schema_version"] < CURRENT_SCHEMA_VERSION:
        fn = _CHAIN.get(current["schema_version"])
        if fn is None:
            ver = current["schema_version"]
            return {"ok": False, "reason": f"no migration registered for v{ver}"}
        before = sum(
            len(current[k])
            for k in ("bundles", "wildcards", "fixed_values", "combines",
                      "derivations", "constraints", "categories")
        )
        current = fn(current)
        migrated_entity_count += before
    return {"ok": True, "migrated": current, "migrated_entity_count": migrated_entity_count}
