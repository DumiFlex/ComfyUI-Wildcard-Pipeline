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

# Highest schema version this runtime can natively READ + WRITE — distinct
# from CURRENT_SCHEMA_VERSION (the migration-chain head, which stays 2 because
# v2->v3/v3->v4 are no-ops). v3 is the SP2b text-grammar bump (shape-identical
# to v2) and v4 is the additive `target_select` constraint reach; both are
# handled natively, so a payload at CURRENT < v <= MAX_KNOWN installs AS-IS
# with no migration. Mirror of TS `MAX_KNOWN_SCHEMA_VERSION` in
# `src/manager/import-export/migrations.ts`.
#
# MAINTENANCE CONTRACT: bump this whenever the TS `schemaVersionForPayload()`
# learns to stamp a new (higher) version — otherwise this commit-side
# re-validate will reject the very shapes the runtime just learned to produce.
MAX_KNOWN_SCHEMA_VERSION = 4

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
    # Reject threshold reads MAX_KNOWN (highest natively-supported version),
    # NOT CURRENT (the migration-chain head). A payload at
    # CURRENT < v <= MAX_KNOWN is shape-compatible and handled natively, so it
    # passes through AS-IS — the while-loop below is bound by CURRENT, so there
    # is nothing to migrate and schema_version is preserved. Only > MAX_KNOWN
    # rejects. Mirror of TS `migrateImportEnvelope`.
    if version > MAX_KNOWN_SCHEMA_VERSION:
        return {
            "ok": False,
            "reason": f"future schema version {version} (max known: {MAX_KNOWN_SCHEMA_VERSION})",
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
