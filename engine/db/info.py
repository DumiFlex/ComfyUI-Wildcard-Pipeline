"""Read-only DB introspection + safe maintenance operations.

Pure Python — no ComfyUI imports, no aiohttp. Each public function takes
a ``sqlite3.Connection`` and returns a dict. Expected-failure modes
(locked DB, integrity errors) are reported via ``ok: False`` payloads,
not exceptions, so the API layer can pass results through verbatim.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from engine.db.migrations import _discover, current_version

# Map module-row "type" column values to the human/UI-facing names used
# in the counts response. Kept in one place so future kinds get a single
# insertion point.
_KIND_TYPES: dict[str, str] = {
    "wildcards": "wildcard",
    "fixed_values": "fixed_values",
    "combines": "combine",
    "derivations": "derivation",
    "constraints": "constraint",
}

# Maps the UI-facing count key to the real SQLite table name. Some
# tables have a `module_` prefix in storage but show up unprefixed in
# the response (e.g. `module_categories` -> "categories") to keep the
# settings card readable.
_TABLE_COUNTS: dict[str, str] = {
    "bundles": "bundles",
    "templates": "templates",
    "categories": "module_categories",
}


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _count_modules_by_type(conn: sqlite3.Connection, type_value: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM modules WHERE type = ?", (type_value,)
    ).fetchone()
    return int(row[0]) if row else 0


def _count_table(conn: sqlite3.Connection, table: str) -> int:
    try:
        row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    except sqlite3.OperationalError:
        # Table might not exist on very old DBs that haven't migrated yet.
        return 0
    return int(row[0]) if row else 0


def _pragma_int(conn: sqlite3.Connection, name: str) -> int:
    row = conn.execute(f"PRAGMA {name}").fetchone()
    return int(row[0]) if row else 0


def _pragma_str(conn: sqlite3.Connection, name: str) -> str:
    row = conn.execute(f"PRAGMA {name}").fetchone()
    return str(row[0]) if row else ""


def _migration_names() -> dict[int, str]:
    """Discover known migration files and map version -> stem name.

    The migrations table only stores ``version`` and ``applied_at``;
    the human-readable name lives in the filename
    (``012_templates.sql`` -> ``012_templates``). Walking the same
    discovery routine the migrator uses keeps this in sync.
    """
    return {version: path.stem for version, path in _discover()}


def _applied_migrations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all rows from the migrations table joined with the
    on-disk migration name. Empty list if the table doesn't exist
    (pre-migration DB)."""
    table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations';"
    ).fetchone()
    if not table:
        return []
    rows = conn.execute(
        "SELECT version, applied_at FROM migrations ORDER BY version ASC"
    ).fetchall()
    names = _migration_names()
    return [
        {
            "version": int(r[0]),
            "name": names.get(int(r[0]), f"migration_{int(r[0]):03d}"),
            "applied_at": str(r[1]),
        }
        for r in rows
    ]


def gather_info(
    conn: sqlite3.Connection, db_path: Path, *, source: str = "unknown"
) -> dict[str, Any]:
    """Return a read-only snapshot of the DB suitable for the SPA card."""
    counts: dict[str, int] = {}
    for ui_name, type_value in _KIND_TYPES.items():
        counts[ui_name] = _count_modules_by_type(conn, type_value)
    for ui_name, table_name in _TABLE_COUNTS.items():
        counts[ui_name] = _count_table(conn, table_name)

    try:
        stat = db_path.stat()
        size_bytes = stat.st_size
        mtime_iso = _iso(stat.st_mtime)
    except OSError:
        size_bytes = 0
        mtime_iso = ""

    return {
        "path": str(db_path),
        "source": source,
        "size_bytes": size_bytes,
        "mtime_iso": mtime_iso,
        "counts": counts,
        "migration": {
            "current_version": current_version(conn),
            "applied": _applied_migrations(conn),
        },
        "pragma": {
            "journal_mode": _pragma_str(conn, "journal_mode"),
            "foreign_keys": _pragma_int(conn, "foreign_keys"),
            "page_size": _pragma_int(conn, "page_size"),
            "page_count": _pragma_int(conn, "page_count"),
            "freelist_count": _pragma_int(conn, "freelist_count"),
        },
    }
