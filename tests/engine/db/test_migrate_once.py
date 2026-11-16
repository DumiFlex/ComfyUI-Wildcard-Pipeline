"""`migrate_once` and the cached migration folder / checksums."""
from __future__ import annotations

import os
import sqlite3

import pytest

from engine.db import migrations as mig
from engine.db.connection import get_connection


@pytest.fixture(autouse=True)
def _fresh_cache():
    mig.forget_migrated()
    yield
    mig.forget_migrated()


@pytest.fixture
def counted(monkeypatch):
    calls: list[str] = []
    real = mig.migrate

    def counting(conn):
        calls.append("migrate")
        real(conn)

    monkeypatch.setattr(mig, "migrate", counting)
    return calls


def test_migrates_a_file_once_per_process(tmp_path, counted):
    for _ in range(3):
        conn = get_connection(tmp_path / "a.db")
        mig.migrate_once(conn)
        assert mig.current_version(conn) == mig.head_version()
        conn.close()
    assert counted == ["migrate"]
    # Another file is its own entry.
    other = get_connection(tmp_path / "b.db")
    mig.migrate_once(other)
    other.close()
    assert counted == ["migrate", "migrate"]


def test_a_file_whose_version_moved_is_migrated_again(tmp_path, counted):
    conn = get_connection(tmp_path / "a.db")
    mig.migrate_once(conn)
    # A restore swapped in an older library: its version is behind.
    with conn:
        conn.execute("DELETE FROM migrations WHERE version = ?", (mig.head_version(),))
    mig.migrate_once(conn)
    assert counted == ["migrate", "migrate"]
    conn.close()


def test_in_memory_databases_always_migrate(counted):
    for _ in range(2):
        conn = sqlite3.connect(":memory:")
        mig.migrate_once(conn)
        conn.close()
    assert counted == ["migrate", "migrate"]


def test_a_failed_migration_is_not_remembered(tmp_path, monkeypatch):
    conn = get_connection(tmp_path / "a.db")

    def boom(_conn):
        raise mig.SchemaAheadError("ahead")

    monkeypatch.setattr(mig, "migrate", boom)
    for _ in range(2):
        with pytest.raises(mig.SchemaAheadError):
            mig.migrate_once(conn)
    conn.close()


def test_discover_sees_a_new_migration_file(tmp_path, monkeypatch):
    folder = tmp_path / "migs"
    folder.mkdir()
    (folder / "001_a.sql").write_text("CREATE TABLE a (x);")
    monkeypatch.setattr(mig, "_SQL_DIR", folder)
    assert [v for v, _ in mig._discover()] == [1]
    assert [v for v, _ in mig._discover()] == [1]
    (folder / "002_b.sql").write_text("CREATE TABLE b (x);")
    st = folder.stat()
    os.utime(folder, ns=(st.st_atime_ns, st.st_mtime_ns + 10_000_000))
    assert [v for v, _ in mig._discover()] == [1, 2]


def test_checksum_is_cached_until_the_file_changes(tmp_path, monkeypatch):
    path = tmp_path / "001_a.sql"
    path.write_text("one")
    first = mig._checksum(path)
    reads: list[int] = []
    real = type(path).read_bytes

    def counting(self):
        reads.append(1)
        return real(self)

    monkeypatch.setattr(type(path), "read_bytes", counting)
    assert mig._checksum(path) == first and reads == []
    path.write_text("two, longer")
    assert mig._checksum(path) != first and reads == [1]
