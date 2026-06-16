"""Migration 014: payload schema_version + verbatim-local mirror columns.

See the community-web design doc at
docs/superpowers/specs/2026-06-05-schema-versioning-migration-design.md
(in the community-web repo) sections 4 + 5 for the design. The columns:

- schema_version (INTEGER NOT NULL DEFAULT 1): the payload's shape
  version. ``1`` is the implicit baseline — every row that existed
  before this migration was authored against shape v1, so the DEFAULT
  doubles as the backfill.
- original_payload_json (TEXT, nullable): verbatim future-shaped
  producer bytes preserved through tolerant installs. NULL means no
  preservation was needed (row was installed at-or-below CURRENT, i.e.
  no future-shape tolerance was applied).
- tolerant_drift_status (TEXT NOT NULL DEFAULT 'none'): enum tracking
  the drift state of the row's payload vs the catalog. ``'none'`` = no
  drift; ``'pending'`` = drifted (tolerant-installed from a future
  shape and not yet reconciled); ``'broken'`` = deferred strict-validate
  failed.
- schema_migrated_at (TEXT, nullable): timestamp of the last structural
  migration on the row. Intentionally SEPARATE from ``updated_at`` —
  structural migration is the engine moving the payload between shape
  versions, not a user edit, so it must not dirty user-edit state.

Backfill: every pre-existing row stamps ``schema_version=1`` and
``tolerant_drift_status='none'`` implicitly via the DEFAULT on the
NOT NULL columns — SQLite materializes the default into existing rows
when ADD COLUMN runs.

Idempotent: each ALTER is gated on ``PRAGMA table_info`` so re-running
the migration against a DB that already has the columns is a no-op.
The migration runner's existing version table guards against re-runs
in production; this guard exists for tests that explicitly rewind the
``migrations`` table to exercise the migration on a populated DB
(see ``tests/engine/db/test_migration_010.py``).
"""
from __future__ import annotations

import sqlite3

from engine.db.migrations_sql._014_helpers import run_bulk_lazy


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    with conn:
        # modules
        if not _has_column(conn, "modules", "schema_version"):
            conn.execute(
                "ALTER TABLE modules ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;"
            )
        if not _has_column(conn, "modules", "original_payload_json"):
            conn.execute("ALTER TABLE modules ADD COLUMN original_payload_json TEXT;")
        if not _has_column(conn, "modules", "tolerant_drift_status"):
            conn.execute(
                "ALTER TABLE modules ADD COLUMN tolerant_drift_status "
                "TEXT NOT NULL DEFAULT 'none';"
            )
        if not _has_column(conn, "modules", "schema_migrated_at"):
            conn.execute("ALTER TABLE modules ADD COLUMN schema_migrated_at TEXT;")

        # bundles
        if not _has_column(conn, "bundles", "schema_version"):
            conn.execute(
                "ALTER TABLE bundles ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;"
            )
        if not _has_column(conn, "bundles", "original_payload_json"):
            conn.execute("ALTER TABLE bundles ADD COLUMN original_payload_json TEXT;")
        if not _has_column(conn, "bundles", "tolerant_drift_status"):
            conn.execute(
                "ALTER TABLE bundles ADD COLUMN tolerant_drift_status "
                "TEXT NOT NULL DEFAULT 'none';"
            )
        if not _has_column(conn, "bundles", "schema_migrated_at"):
            conn.execute("ALTER TABLE bundles ADD COLUMN schema_migrated_at TEXT;")

    # Bulk run: at the time 014 ships, CURRENT_SCHEMA_VERSION is still 1, so
    # every existing row is already at CURRENT and the bulk is a no-op pass.
    # We invoke it anyway to exercise + validate the wiring on first run.
    # FUTURE: when a bump migration 015 ships, it ALSO calls run_bulk_lazy
    # with the new CURRENT and the bump's migrators.
    run_bulk_lazy(conn, current_version=1, migrators={}, validators={}, tolerant_strip={})
