"""engine/db/backups.py:restore_now — restore into the live library, no restart."""
from __future__ import annotations

import sqlite3

import pytest

from engine.db import backups as bk
from engine.db import config as dbcfg
from engine.db import migrations as mig
from engine.db.connection import get_connection


@pytest.fixture
def sidecar(tmp_path, monkeypatch):
    p = tmp_path / "db-config.json"
    monkeypatch.setattr(dbcfg, "SIDECAR_PATH", p)
    return p


@pytest.fixture
def lib(tmp_path, monkeypatch, sidecar):
    """A migrated library holding one category, 'kept'."""
    path = tmp_path / "lib" / "wildcard-pipeline.db"
    monkeypatch.setenv("WP_DB_PATH", str(path))
    conn = get_connection(path)
    mig.migrate(conn)
    _add_category(conn, "kept")
    conn.close()
    return path


def _add_category(conn: sqlite3.Connection, name: str) -> None:
    with conn:
        conn.execute("INSERT INTO module_categories(id, name) VALUES (?, ?)", (name, name))


def _categories(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute("SELECT name FROM module_categories ORDER BY name")]


def _cats_at(path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return _categories(conn)
    finally:
        conn.close()


def _edit_backup(lib, name: str, *sql: str) -> None:
    conn = sqlite3.connect(str(bk.backups_dir(lib) / name))
    with conn:
        for stmt in sql:
            conn.execute(stmt)
    conn.close()


def test_restore_now_swaps_the_library_under_an_open_connection(lib):
    snap = bk.create_backup(lib, "manual")
    reader = get_connection(lib)  # a request, or a canvas run, still holding a connection
    _add_category(reader, "added-later")
    assert _categories(reader) == ["added-later", "kept"]

    out = bk.restore_now(lib, snap["name"])

    assert out["restored"] == snap["name"]
    assert _categories(reader) == ["kept"]  # the open connection sees the restore
    reader.close()
    assert _cats_at(lib) == ["kept"]
    pre = bk.backups_dir(lib) / out["pre_restore"]
    assert "pre-restore" in out["pre_restore"]
    assert _cats_at(pre) == ["added-later", "kept"]  # the restore can be undone


def test_restore_now_can_undo_itself(lib):
    snap = bk.create_backup(lib, "manual")
    conn = get_connection(lib)
    _add_category(conn, "mine")
    conn.close()
    out = bk.restore_now(lib, snap["name"])
    bk.restore_now(lib, out["pre_restore"])
    assert _cats_at(lib) == ["kept", "mine"]


def test_restore_now_migrates_an_older_backup(lib):
    snap = bk.create_backup(lib, "manual")
    head = mig.head_version()
    _edit_backup(lib, snap["name"],
                 "DROP TABLE health_ignored",
                 "DELETE FROM migrations WHERE version >= 22")

    bk.restore_now(lib, snap["name"])

    conn = get_connection(lib)
    try:
        assert mig.current_version(conn) == head
        conn.execute("SELECT key FROM health_ignored").fetchall()
    finally:
        conn.close()


def test_restore_now_refuses_a_backup_from_a_newer_build(lib):
    snap = bk.create_backup(lib, "manual")
    _edit_backup(lib, snap["name"],
                 "INSERT INTO migrations(version, applied_at) VALUES (999, 'x')")
    conn = get_connection(lib)
    _add_category(conn, "live")
    conn.close()

    with pytest.raises(bk.RestoreRefused, match="newer version"):
        bk.restore_now(lib, snap["name"])

    assert _cats_at(lib) == ["kept", "live"]
    assert [e["reason"] for e in bk.list_backups(lib)] == ["manual"]  # nothing written


def test_restore_now_refuses_a_damaged_backup(lib):
    snap = bk.create_backup(lib, "manual")
    (bk.backups_dir(lib) / snap["name"]).write_bytes(b"not a database" * 100)
    with pytest.raises(bk.RestoreRefused):
        bk.restore_now(lib, snap["name"])
    assert _cats_at(lib) == ["kept"]


def test_restore_now_refuses_a_database_that_is_not_a_library(lib):
    snap = bk.create_backup(lib, "manual")
    other = sqlite3.connect(str(bk.backups_dir(lib) / snap["name"]))
    with other:
        for (table,) in other.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%'").fetchall():
            other.execute(f'DROP TABLE "{table}"')
        other.execute("CREATE TABLE t (v TEXT)")
    other.close()
    with pytest.raises(bk.RestoreRefused, match="isn't a Wildcard Pipeline library"):
        bk.restore_now(lib, snap["name"])
    assert _cats_at(lib) == ["kept"]


def test_restore_now_handles_another_page_size(lib):
    snap = bk.create_backup(lib, "manual")
    path = bk.backups_dir(lib) / snap["name"]
    conv = sqlite3.connect(str(path))
    conv.execute("PRAGMA journal_mode=DELETE")
    conv.execute("PRAGMA page_size=8192")
    conv.execute("VACUUM")
    assert conv.execute("PRAGMA page_size").fetchone()[0] == 8192
    conv.close()
    conn = get_connection(lib)
    _add_category(conn, "later")
    conn.close()

    bk.restore_now(lib, snap["name"])

    assert _cats_at(lib) == ["kept"]
    assert not list(bk.backups_dir(lib).glob(".restore-*"))  # temp copy cleaned up


def test_restore_now_supersedes_a_staged_restore(lib):
    snap = bk.create_backup(lib, "manual")
    bk.stage_restore(lib, snap["name"])
    bk.restore_now(lib, snap["name"])
    assert "pending_restore" not in dbcfg.load()


def test_restore_now_unknown_backup(lib):
    with pytest.raises(bk.BackupNotFound):
        bk.restore_now(lib, "wildcard-pipeline-20260101-000000-manual.db")
