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

import hashlib
import importlib.util
import re
import sqlite3
from collections.abc import Callable
from pathlib import Path

from engine._utils import now_iso

_SQL_DIR = Path(__file__).parent / "migrations_sql"
_VERSION_RE = re.compile(r"^(\d{3})_.+\.(sql|py)$")


class SchemaAheadError(RuntimeError):
    """The database was migrated by a build this one cannot safely read.

    Raised instead of letting the runner's "skip anything already applied"
    rule quietly hand a foreign schema to code that expects its own.
    """


def _checksum(path: Path) -> str:
    """sha256 of a migration file's bytes.

    Bytes, not parsed content: a `.py` migration's behaviour lives in code the
    runner `exec`s, so any edit at all is a different migration regardless of
    whether the SQL it emits looks the same.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def head_version() -> int:
    """Highest migration version this build ships."""
    pairs = _discover()
    return pairs[-1][0] if pairs else 0


def _has_checksum_column(conn: sqlite3.Connection) -> bool:
    cur = conn.execute("PRAGMA table_info(migrations);")
    return any(row[1] == "checksum" for row in cur.fetchall())


def _record(conn: sqlite3.Connection, version: int, mig_file: Path) -> None:
    """Insert the applied-migration row, with a checksum when we can store one.

    Migration 017 is what adds the column, so on a fresh database every
    migration before it inserts without one. Those rows stay NULL forever —
    see the 017 docblock for why backfilling them would defeat the check.
    """
    if _has_checksum_column(conn):
        conn.execute(
            "INSERT INTO migrations(version, applied_at, checksum) VALUES(?, ?, ?);",
            (version, now_iso(), _checksum(mig_file)),
        )
    else:
        conn.execute(
            "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
            (version, now_iso()),
        )


def assert_schema_compatible(conn: sqlite3.Connection) -> None:
    """Refuse to touch a database some other build's migrations shaped.

    Two distinct failures, both silent before this existed:

    1. The database is AHEAD — migrated by a newer build. Every migration is
       `<= MAX(version)`, so the runner does nothing and the caller reads a
       schema it has never seen.
    2. The database is at the SAME version but a DIFFERENT shape, because a
       migration file changed after it had already run somewhere. Version
       numbers match, so nothing compares anything.

    Both are cumulative: each subsequent write goes through code whose
    assumptions about the row shape are wrong. Raising is recoverable;
    continuing is not.
    """
    if not _migrations_table_exists(conn):
        return

    applied = current_version(conn)
    head = head_version()
    if applied > head:
        raise SchemaAheadError(
            f"This database was migrated to version {applied}, but this build only "
            f"knows up to {head}. It was almost certainly written by a newer "
            f"version of Wildcard Pipeline. Reading it here could corrupt your "
            f"library — install the newer version again, or restore a backup."
        )

    if not _has_checksum_column(conn):
        return

    known = dict(_discover())
    rows = conn.execute(
        "SELECT version, checksum FROM migrations WHERE checksum IS NOT NULL;"
    ).fetchall()
    for version, checksum in rows:
        mig_file = known.get(int(version))
        # Unknown version is the `applied > head` case, already handled above.
        if mig_file is None:
            continue
        if _checksum(mig_file) != checksum:
            raise SchemaAheadError(
                f"Migration {int(version):03d} was applied by a build whose copy of "
                f"it differs from this one's. The version numbers match but the "
                f"schemas may not, so this build cannot safely read your library. "
                f"Restore a backup taken before that build ran."
            )


def migrate(conn: sqlite3.Connection) -> None:
    """Apply all pending migrations. Safe to call repeatedly.

    Guards first: applying this build's migrations on top of a schema another
    build shaped is how a mismatch becomes permanent.
    """
    assert_schema_compatible(conn)
    applied = current_version(conn)
    for version, mig_file in _discover():
        if version <= applied:
            continue
        if mig_file.suffix == ".py":
            up = _load_py_migration(mig_file)
            with conn:
                up(conn)
                _record(conn, version, mig_file)
        else:
            sql = mig_file.read_text(encoding="utf-8")
            with conn:
                for stmt in sql.split(";"):
                    stmt = stmt.strip()
                    if stmt:
                        conn.execute(stmt)
                _record(conn, version, mig_file)
