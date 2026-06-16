"""Lazy-read routine — the ONE migration runtime.

See community-web spec
D:\\Desktop\\Wildcard-Pipeline-Community\\docs\\superpowers\\specs\\
2026-06-05-schema-versioning-migration-design.md §4 Flow 5. Every row
read (loadModule / loadBundle) goes through this function; the engine
startup bulk runner also calls it for each stale row.

Six branches:
  1. No-op (row at CURRENT, original NULL or original.sv ≤ CURRENT).
  2. NULL-drop optimization (row.sv == CURRENT, original.sv == CURRENT).
  3. Recovery exact catch-up (original.sv ≤ CURRENT, strict-validate
     succeeds): promote original into payload, NULL original column.
  4. Still-drifted re-project (original.sv > CURRENT): tolerantly strip.
  5. Deferred strict-validate failure: mark row 'broken'.
  6. Standard forward chain (row.sv < CURRENT, no recovery applicable).

CRITICAL bug-fix from spec §4: the write-back gate is
'base_v < current OR base IS original', NOT just 'base_v < current'.
Otherwise the recovery exact-catch-up case (base_v == current AND base
IS original) silently no-ops and the row stays drifted.

The three dependency-injected dicts:
  migrators[(kind, v)]                    → (payload, ctx) -> next_payload
  validators[(kind, v, subtype)]          → payload -> bool
  tolerant_strip[(kind, target_v, sub)]   → payload -> stripped_payload

Subtype lookup: for modules, derived from payload["type"]; for bundles, None.
original_payload_json is INERT — only the initial tolerant install + this
NULL-drop touch it. schema_migrated_at is SEPARATE from updated_at
(structural migration is not a user edit).
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from typing import Any

from engine._utils import now_iso

Migrators = dict[tuple[str, int], Callable[[dict[str, Any], dict], dict]]
Validators = dict[tuple[str, int, str | None], Callable[[dict[str, Any]], bool]]
TolerantStrip = dict[tuple[str, int, str | None], Callable[[dict[str, Any]], dict]]


def lazy_migrate_row(
    conn: sqlite3.Connection,
    *,
    kind: str,
    row_id: str,
    current_version: int,
    migrators: Migrators,
    validators: Validators,
    tolerant_strip: TolerantStrip | None = None,
) -> None:
    """Apply lazy migration to a single row.

    Idempotent: if row is already at CURRENT and original is NULL or
    matches CURRENT, returns without writing (or fires NULL-drop only).
    """
    table = "modules" if kind == "module" else "bundles"
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)).fetchone()
    if row is None:
        return

    sv = row["schema_version"]
    original_raw = row["original_payload_json"]
    original = json.loads(original_raw) if original_raw else None
    # Narrow original_v to int so the rest of the function's `original is not None`
    # checks correctly imply an int. A malformed original (no schema_version, or
    # non-int) is demoted to the no-original branch — the row's payload column is
    # the only thing we trust.
    original_v: int | None = None
    if original is not None:
        raw_v = original.get("schema_version")
        if isinstance(raw_v, int):
            original_v = raw_v
        else:
            original = None
    payload = json.loads(row["payload"])
    subtype = payload.get("type") if kind == "module" else None

    # Branch 1: no-op or NULL-drop
    if sv == current_version and (
        original is None or (original_v is not None and original_v <= current_version)
    ):
        if original is not None and original_v == sv:
            conn.execute(
                f"UPDATE {table} SET original_payload_json=NULL, "
                f"tolerant_drift_status='none' WHERE id=?",
                (row_id,),
            )
            conn.commit()
        return

    # Decide base
    base_is_original = False
    base_v: int
    if original is not None and original_v is not None and original_v > sv:
        if original_v <= current_version:
            # Recovery candidate — deferred strict-validate FIRST
            strict = validators.get((kind, original_v, subtype))
            if strict is not None and not strict(original):
                conn.execute(
                    f"UPDATE {table} SET tolerant_drift_status='broken', "
                    f"schema_migrated_at=? WHERE id=?",
                    (now_iso(), row_id),
                )
                conn.commit()
                return
            base = original
            base_v = original_v
            base_is_original = True
        else:
            # Still drifted; tolerantly strip original down to current
            strip = (tolerant_strip or {}).get((kind, current_version, subtype))
            if strip is None:
                return
            projected = strip(original)
            conn.execute(
                f"UPDATE {table} SET payload=?, schema_version=?, "
                f"tolerant_drift_status='pending', schema_migrated_at=? WHERE id=?",
                (
                    json.dumps(projected),
                    current_version,
                    now_iso(),
                    row_id,
                ),
            )
            conn.commit()
            return
    else:
        base = payload
        base_v = sv

    # Write-back gate (THE BUG FIX): write when base_v < current OR base IS original.
    # The recovery exact-catch-up case has zero chain steps (base_v == current_version)
    # but still needs the write to promote original into payload + NULL the original
    # column. Gating on 'base_v < current_version' alone silently no-ops the recovery.
    needs_write = (base_v < current_version) or base_is_original
    if not needs_write:
        return

    new_payload = base
    for v in range(base_v, current_version):
        migrator = migrators.get((kind, v))
        if migrator is None:
            return
        new_payload = migrator(new_payload, {})

    promote_from_original = base_is_original
    conn.execute(
        f"UPDATE {table} SET payload=?, schema_version=?, schema_migrated_at=?, "
        f"original_payload_json=?, tolerant_drift_status=? WHERE id=?",
        (
            json.dumps(new_payload),
            current_version,
            now_iso(),
            None if promote_from_original else row["original_payload_json"],
            "none" if promote_from_original else row["tolerant_drift_status"],
            row_id,
        ),
    )
    conn.commit()
