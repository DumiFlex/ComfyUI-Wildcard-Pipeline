"""Migration 017 — record WHICH migration ran, not just how many.

``migrations`` tracked only ``version``, and the runner skips anything
``<= MAX(version)``. That makes an integer the entire identity of a
schema, which it is not:

- A build whose head is 015 opened against a DB migrated to 016 skips
  every migration, finds nothing to do, and reads a schema it has never
  seen. Additive columns survive; a shape change does not.
- Worse, two builds can both call something "016" and mean different
  things — a reworked migration, a hand-edited file, a branch that never
  shipped. The version matches, so nothing anywhere notices.

Both are silent, and both corrupt cumulatively: every subsequent write
goes through code whose assumptions about the row shape are wrong.

``checksum`` fixes it by storing the sha256 of the migration file that
actually ran. ``assert_schema_compatible`` then compares applied
checksums against the files this build ships, so a divergence is a
loud, recoverable error instead of silence.

Nullable on purpose: rows applied before this migration existed have no
recorded checksum and cannot retroactively grow one. The guard skips
them rather than guessing — a NULL means "unknown", never "mismatched".

Idempotent via ``PRAGMA table_info`` so tests that rewind the
``migrations`` table can re-run it against a populated DB.
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    if not _has_column(conn, "migrations", "checksum"):
        conn.execute("ALTER TABLE migrations ADD COLUMN checksum TEXT;")
