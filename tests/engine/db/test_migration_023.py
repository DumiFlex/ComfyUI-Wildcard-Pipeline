"""Migration 023: saved templates' negatives get the slot the old rule implied."""
from __future__ import annotations

import importlib
import sqlite3

mig = importlib.import_module("engine.db.migrations_sql.023_template_negatives_opt_in")


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE templates (id TEXT PRIMARY KEY, negative_template TEXT);")
    conn.executemany(
        "INSERT INTO templates VALUES (?, ?);",
        [("a", ""), ("b", "lowres, watermark"), ("c", "$negatives, lowres"), ("d", None)],
    )
    return conn


def _rows(conn: sqlite3.Connection) -> dict:
    return dict(conn.execute("SELECT id, negative_template FROM templates;").fetchall())


def test_adds_the_slot_the_old_rule_implied():
    conn = _db()
    mig.up(conn)
    assert _rows(conn) == {
        "a": "$negatives",
        "b": "lowres, watermark, $negatives",
        "c": "$negatives, lowres",
        "d": None,
    }


def test_idempotent():
    conn = _db()
    mig.up(conn)
    first = _rows(conn)
    mig.up(conn)
    assert _rows(conn) == first


def test_no_column_is_a_no_op():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE templates (id TEXT PRIMARY KEY);")
    mig.up(conn)
