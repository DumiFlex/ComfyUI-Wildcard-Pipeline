"""Migration 023 -- saved templates keep their negatives under the opt-in rule.

The Assembler's negative box used to get the collected negative words even
without ``$negatives``: an empty box was just those words, and text without
the slot got them added at the end. Negatives are opt-in now (without
``$negatives`` the box is only its own text), so a template saved before
would load into an Assembler and quietly drop its variables' negatives.

Every saved ``negative_template`` string gets the slot the old rule implied
(``engine.negatives.with_slot``): ``""`` → ``"$negatives"``, ``"lowres"`` →
``"lowres, $negatives"``. NULL stays NULL (a template saved before negatives
existed leaves the Assembler's box as it is).

Row data, not a payload shape: no ``schema_version`` bump.

Idempotent: ``with_slot`` leaves a value that has the slot unchanged.
"""
from __future__ import annotations

import sqlite3

from engine.negatives import with_slot


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    if not _has_column(conn, "templates", "negative_template"):
        return
    rows = conn.execute(
        "SELECT id, negative_template FROM templates WHERE negative_template IS NOT NULL;"
    ).fetchall()
    with conn:
        for row in rows:
            old = row[1]
            new = with_slot(old)
            if new != old:
                conn.execute(
                    "UPDATE templates SET negative_template = ? WHERE id = ?;", (new, row[0]),
                )
