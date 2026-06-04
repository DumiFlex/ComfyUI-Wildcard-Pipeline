"""Migration 013 — community install origin columns.

Adds ``community_post_slug`` and ``community_version_number`` to both
``modules`` and ``bundles``. Stamped at install time by the host-bridge
``install()`` path (via the embed's ``origin`` opt) so the SPA can:

- Render an "installed from community" pill on origin-stamped rows.
- Run an update-availability check that compares
  ``community_version_number`` against the post's
  ``latest_version_number`` in the community API.

Both columns are nullable on purpose — locally-authored rows (Create
flow, Import-from-file, starter set) leave them NULL forever.

Idempotent: each ALTER is gated on ``PRAGMA table_info`` so re-running
the migration against a DB that already has the columns is a no-op.
The migration runner's existing version table guards against re-runs
in production; this guard exists for tests that explicitly rewind the
``migrations`` table to exercise the migration on a populated DB
(see ``tests/engine/db/test_migration_010.py``).
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    with conn:
        if not _has_column(conn, "modules", "community_post_slug"):
            conn.execute("ALTER TABLE modules ADD COLUMN community_post_slug TEXT;")
        if not _has_column(conn, "modules", "community_version_number"):
            conn.execute("ALTER TABLE modules ADD COLUMN community_version_number INTEGER;")
        if not _has_column(conn, "bundles", "community_post_slug"):
            conn.execute("ALTER TABLE bundles ADD COLUMN community_post_slug TEXT;")
        if not _has_column(conn, "bundles", "community_version_number"):
            conn.execute("ALTER TABLE bundles ADD COLUMN community_version_number INTEGER;")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_modules_community_slug "
            "ON modules(community_post_slug);"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_bundles_community_slug "
            "ON bundles(community_post_slug);"
        )
