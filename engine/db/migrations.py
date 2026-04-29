"""Versioned, forward-only migration runner.

Migration files live in ``engine/db/migrations_sql/<NNN>_<name>.<ext>``
where ``<ext>`` is ``.sql`` (executed verbatim) or ``.py`` (imported and
its top-level ``up(conn)`` callable invoked). Filenames must start with
a 3-digit zero-padded version number; the runner applies them in
numeric order.

Python migrations are useful when a transformation needs to read row
payloads, mutate JSON, or otherwise do work SQL alone can't express
cleanly. The ``.py`` file is imported via ``importlib.util`` so it
can sit next to the ``.sql`` files without polluting the package's
import graph.
"""
from __future__ import annotations

import importlib.util
import re
import sqlite3
from collections.abc import Callable
from pathlib import Path

from engine._utils import now_iso

_SQL_DIR = Path(__file__).parent / "migrations_sql"
_VERSION_RE = re.compile(r"^(\d{3})_.+\.(sql|py)$")


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


def _load_py_migration(path: Path) -> Callable[[sqlite3.Connection], object]:
    """Import a `.py` migration file and return its `up` callable.

    The module is loaded via ``importlib.util.spec_from_file_location``
    so it doesn't have to be importable through a normal package path —
    callers can drop a script into ``migrations_sql/`` without adding
    it to ``__init__.py``. Return value of `up` is ignored.
    """
    spec = importlib.util.spec_from_file_location(f"_mig_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load migration module at {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    up = getattr(mod, "up", None)
    if not callable(up):
        raise RuntimeError(
            f"Migration {path.name} must export a top-level `up(conn)` function."
        )
    return up  # type: ignore[no-any-return]


def migrate(conn: sqlite3.Connection) -> None:
    """Apply all pending migrations. Safe to call repeatedly."""
    applied = current_version(conn)
    for version, mig_file in _discover():
        if version <= applied:
            continue
        if mig_file.suffix == ".py":
            up = _load_py_migration(mig_file)
            with conn:
                up(conn)
                conn.execute(
                    "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
                    (version, now_iso()),
                )
        else:
            sql = mig_file.read_text(encoding="utf-8")
            with conn:
                for stmt in sql.split(";"):
                    stmt = stmt.strip()
                    if stmt:
                        conn.execute(stmt)
                conn.execute(
                    "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
                    (version, now_iso()),
                )
