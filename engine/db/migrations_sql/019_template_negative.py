"""Migration 019 -- negative_template column on saved prompt templates.

Send-to-negative gives the PromptAssembler a second box, the negative
template (``$vars`` plus the reserved ``$negatives`` slot). A saved
template stores both boxes, so ``templates`` gains ``negative_template``
(TEXT, nullable, no default).

NULL is meaningful: a template saved before this migration has no
negative, and loading it leaves the Assembler's negative box as it was
instead of blanking it. A template saved afterwards stores a string,
even an empty one, so loading it sets the box.

Row-level column, not a payload shape: no ``schema_version`` bump.

Idempotent: the ALTER is gated on ``PRAGMA table_info``. The migration
runner's version table is the primary re-run guard; the column check
exists for test fixtures that rewind ``migrations``.
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    with conn:
        if not _has_column(conn, "templates", "negative_template"):
            conn.execute("ALTER TABLE templates ADD COLUMN negative_template TEXT;")
