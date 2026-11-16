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
import threading
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


#: sha256 per migration file, keyed by (path, size, mtime): the guard below
#: re-checks every applied migration on each `migrate`, and the files of a
#: running build don't change. An edited file has a new key, so it is hashed
#: again.
_CHECKSUMS: dict[tuple[str, int, int], str] = {}
#: `_discover()` per migrations folder, keyed by the folder's mtime (adding or
#: removing a file moves it).
_DISCOVERED: dict[tuple[str, int], tuple[tuple[int, Path], ...]] = {}
#: DB files this process has migrated (`migrate_once`), with the version they
#: were left at.
_MIGRATED: dict[str, int] = {}
_MIGRATED_LOCK = threading.Lock()


def _checksum(path: Path) -> str:
    """sha256 of a migration file's bytes.

    Bytes, not parsed content: a `.py` migration's behaviour lives in code the
    runner `exec`s, so any edit at all is a different migration regardless of
    whether the SQL it emits looks the same.
    """
    try:
        st = path.stat()
        key: tuple[str, int, int] | None = (str(path), st.st_size, st.st_mtime_ns)
    except OSError:
        key = None
    if key is not None and key in _CHECKSUMS:
        return _CHECKSUMS[key]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if key is not None:
        _CHECKSUMS[key] = digest
    return digest


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
    folder = _SQL_DIR
    try:
        key: tuple[str, int] | None = (str(folder), folder.stat().st_mtime_ns)
    except OSError:
        key = None
    if key is not None and key in _DISCOVERED:
        return list(_DISCOVERED[key])
    pairs: list[tuple[int, Path]] = []
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        m = _VERSION_RE.match(entry.name)
        if not m:
            continue
        pairs.append((int(m.group(1)), entry))
    pairs.sort(key=lambda p: p[0])
    if key is not None:
        _DISCOVERED[key] = tuple(pairs)
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


def _backup_if_upgrading(conn: sqlite3.Connection, applied: int) -> None:
    """Snapshot an existing library before this build changes its schema.

    Only when there is something to lose AND something about to change: a
    fresh database (``applied == 0``) has no data, an up-to-date one has no
    pending step, and an in-memory one has no file. `backup_before_migration`
    swallows its own failures — a backup problem never blocks a migration.
    """
    if applied <= 0:
        return
    if not any(version > applied for version, _ in _discover()):
        return
    from engine.db.backups import backup_before_migration

    backup_before_migration(conn)


def _db_file(conn: sqlite3.Connection) -> str:
    """The resolved file behind ``conn``'s main database ("" in memory)."""
    for row in conn.execute("PRAGMA database_list;").fetchall():
        if row[1] == "main":
            name = row[2] or ""
            if not name:
                return ""
            try:
                return str(Path(name).resolve())
            except OSError:
                return name
    return ""


def migrate_once(conn: sqlite3.Connection) -> None:
    """`migrate`, once per database file per process.

    The API routes migrate at startup, so a route (or a graph run) that opens
    the library again only needs to know it is still the database it already
    migrated: the full `migrate` re-hashes every migration file and re-reads
    the folder (~14 ms), which the preview used to pay per chain step per
    keystroke. A file whose version moved since (a restore swapped in an older
    library, another build ran) is migrated again.
    """
    key = _db_file(conn)
    if key:
        with _MIGRATED_LOCK:
            known = _MIGRATED.get(key)
        if known is not None and current_version(conn) == known:
            return
    migrate(conn)
    if key:
        with _MIGRATED_LOCK:
            _MIGRATED[key] = current_version(conn)


def forget_migrated() -> None:
    """Make `migrate_once` run `migrate` again for every file. For tests."""
    with _MIGRATED_LOCK:
        _MIGRATED.clear()


def migrate(conn: sqlite3.Connection) -> None:
    """Apply all pending migrations. Safe to call repeatedly.

    Guards first: applying this build's migrations on top of a schema another
    build shaped is how a mismatch becomes permanent.
    """
    assert_schema_compatible(conn)
    applied = current_version(conn)
    _backup_if_upgrading(conn, applied)
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
