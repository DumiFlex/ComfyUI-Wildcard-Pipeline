"""Migration 015 -- content_rating column on library rows.

Adds ``content_rating`` (TEXT, default 'safe') to both ``modules`` and
``bundles``. Stamped by:

- The IdentityCard's NSFW toggle in every editor (user-controlled
  flag the author sets on their own row).
- The community install bridge when ``opts.origin.content_rating`` is
  supplied -- NSFW community posts auto-stamp the row at install
  time, so the SPA can render the ``18+`` pill without an extra
  fetch.

Default 'safe' means rows that pre-date this migration (every
locally-authored row prior to v2.3) end up marked safe. Toggle to
'nsfw' if needed. No CHECK constraint at the DB level (SQLite ALTER
TABLE does not support adding CHECK); validation happens at the
application layer (``set_content_rating``).

Idempotent: each ALTER is gated on ``PRAGMA table_info``. The
migration runner's version table is the primary re-run guard; the
column check exists for test fixtures that rewind ``migrations``.
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    with conn:
        if not _has_column(conn, "modules", "content_rating"):
            conn.execute(
                "ALTER TABLE modules ADD COLUMN content_rating TEXT "
                "NOT NULL DEFAULT 'safe';"
            )
        if not _has_column(conn, "bundles", "content_rating"):
            conn.execute(
                "ALTER TABLE bundles ADD COLUMN content_rating TEXT "
                "NOT NULL DEFAULT 'safe';"
            )
