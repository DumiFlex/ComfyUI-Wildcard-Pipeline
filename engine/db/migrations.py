"""Versioned, forward-only migration runner.

SQL files live in ``engine/db/migrations_sql/<NNN>_<name>.sql``. Filenames
must start with a 3-digit zero-padded version number; the runner applies
them in numeric order.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from engine._utils import now_iso

_SQL_DIR = Path(__file__).parent / "migrations_sql"
_VERSION_RE = re.compile(r"^(\d{3})_.+\.sql$")


def _migrations_table_exists(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name='migrations';"
    ).fetchone()
    return row is not None


def current_version(conn: sqlite3.Connection) -> int:
    if not _migrations_table_exists(conn):
        return 0
    row = conn.execute("SELECT MAX(version) FROM migrations;").fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _discover() -> list[tuple[int, Path]]:
    pairs: list[tuple[int, Path]] = []
    for entry in _SQL_DIR.iterdir():
        if not entry.is_file():
            continue
        m = _VERSION_RE.match(entry.name)
        if not m:
            continue
        pairs.append((int(m.group(1)), entry))
    pairs.sort(key=lambda p: p[0])
    return pairs


def migrate(conn: sqlite3.Connection) -> None:
    """Apply all pending migrations. Safe to call repeatedly."""
    applied = current_version(conn)
    for version, sql_file in _discover():
        if version <= applied:
            continue
        sql = sql_file.read_text(encoding="utf-8")
        with conn:
            for stmt in sql.split(";"):
                stmt = stmt.strip()
                if stmt:
                    conn.execute(stmt)
            conn.execute(
                "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
                (version, now_iso()),
            )
