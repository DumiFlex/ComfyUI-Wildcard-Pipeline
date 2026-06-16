"""Helpers for migration 014 — the bulk runner used at startup + at
future payload-bump migrations.

See community-web spec
D:\\Desktop\\Wildcard-Pipeline-Community\\docs\\superpowers\\specs\\
2026-06-05-schema-versioning-migration-design.md §4 Flow 4: bulk is
EAGER ITERATION of the lazy-read routine, NOT a parallel forward-chain
implementation. This eliminates the transient-wrong window where bulk
could write fabricated defaults over recoverable data preserved in
original_payload_json.
"""
from __future__ import annotations

import sqlite3

from engine.db.lazy_migrate import lazy_migrate_row

STALE_PREDICATE = (
    "schema_version < ? "
    "OR (original_payload_json IS NOT NULL AND "
    "    json_extract(original_payload_json, '$.schema_version') > schema_version)"
)


def run_bulk_lazy(
    conn: sqlite3.Connection,
    *,
    current_version: int,
    migrators,
    validators,
    tolerant_strip,
) -> int:
    """Eager iteration of lazy_migrate_row over every stale row.

    The stale predicate catches BOTH 'sv < current' AND 'tolerantly-
    installed row whose original now outranks the projection'. The
    second clause handles rows where the extension has caught up after
    a previous tolerant install.

    Returns count of rows that failed to migrate (caller surfaces a
    dashboard banner when > 0).
    """
    failed = 0
    for table, kind in [("modules", "module"), ("bundles", "bundle")]:
        ids = [
            row["id"]
            for row in conn.execute(
                f"SELECT id FROM {table} WHERE {STALE_PREDICATE}",
                (current_version,),
            ).fetchall()
        ]
        for row_id in ids:
            try:
                lazy_migrate_row(
                    conn,
                    kind=kind,
                    row_id=row_id,
                    current_version=current_version,
                    migrators=migrators,
                    validators=validators,
                    tolerant_strip=tolerant_strip,
                )
            except Exception:  # noqa: BLE001 — defensive sweep
                failed += 1
                continue
            # After lazy_migrate_row: if the row's schema_version is still
            # below current_version, count as failed.
            after = conn.execute(
                f"SELECT schema_version FROM {table} WHERE id=?", (row_id,)
            ).fetchone()
            if after and after["schema_version"] < current_version:
                failed += 1
    return failed
