"""Tests for engine.db.info — DB introspection + maintenance."""
from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from engine.db.connection import get_connection
from engine.db.info import gather_info
from engine.db.migrations import migrate


@pytest.fixture
def fresh_db(tmp_path: Path) -> Iterator[tuple[sqlite3.Connection, Path]]:
    db_path = tmp_path / "wp.db"
    conn = get_connection(db_path)
    migrate(conn)
    yield conn, db_path
    conn.close()


def test_gather_info_returns_expected_top_level_keys(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert set(info.keys()) >= {
        "path", "source", "size_bytes", "mtime_iso",
        "counts", "migration", "pragma",
    }


def test_gather_info_path_matches_input(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert info["path"] == str(db_path)


def test_gather_info_counts_empty_db(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    counts = info["counts"]
    for key in ("wildcards", "fixed_values", "combines", "derivations",
                "constraints", "bundles", "templates", "categories"):
        assert counts[key] == 0, f"empty DB should have 0 {key}, got {counts[key]}"


def test_gather_info_counts_after_insert(fresh_db):
    conn, db_path = fresh_db
    conn.execute(
        "INSERT INTO modules (id, type, name, payload, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("abcd1234", "wildcard", "test", "{}", "2026-01-01", "2026-01-01"),
    )
    conn.commit()
    info = gather_info(conn, db_path)
    assert info["counts"]["wildcards"] == 1


def test_gather_info_pragma_contains_wal(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert info["pragma"]["journal_mode"] == "wal"
    assert info["pragma"]["foreign_keys"] == 1
    assert info["pragma"]["page_size"] >= 1024
    assert "page_count" in info["pragma"]
    assert "freelist_count" in info["pragma"]


def test_gather_info_migration_lists_applied(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert info["migration"]["current_version"] >= 1
    applied = info["migration"]["applied"]
    assert isinstance(applied, list)
    assert all("version" in m and "name" in m for m in applied)


def test_gather_info_size_and_mtime(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert info["size_bytes"] > 0
    assert info["mtime_iso"].endswith("+00:00") or "T" in info["mtime_iso"]


def test_gather_info_includes_source_when_provided(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path, source="WP_DB_PATH")
    assert info["source"] == "WP_DB_PATH"


def test_gather_info_default_source_is_unknown(fresh_db):
    conn, db_path = fresh_db
    info = gather_info(conn, db_path)
    assert info["source"] == "unknown"


def test_vacuum_returns_ok_and_duration(fresh_db):
    from engine.db.info import vacuum
    conn, _ = fresh_db
    result = vacuum(conn)
    assert result["ok"] is True
    assert result["op"] == "vacuum"
    assert "duration_ms" in result
    assert "bytes_reclaimed" in result
    assert result["duration_ms"] >= 0


def test_vacuum_reclaims_freelist_after_delete(fresh_db, tmp_path):
    from engine.db.info import vacuum
    conn, db_path = fresh_db
    # Pad the DB with bulk inserts then delete to grow the freelist.
    for i in range(500):
        conn.execute(
            "INSERT INTO modules (id, type, name, payload, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (f"{i:08x}", "wildcard", f"pad{i}", '{"x":"' + ("y" * 200) + '"}',
             "2026-01-01", "2026-01-01"),
        )
    conn.commit()
    conn.execute("DELETE FROM modules WHERE name LIKE 'pad%'")
    conn.commit()
    # WAL mode keeps pending writes in the -wal sidecar; force a
    # checkpoint so the main DB file reflects the inflated post-delete
    # state before we measure size_before. Without this, the main file
    # stays at one page (4096 bytes) until the next auto-checkpoint
    # and the test's shrinkage invariant can't hold.
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    size_before = db_path.stat().st_size
    result = vacuum(conn)
    size_after = db_path.stat().st_size
    assert result["ok"] is True
    assert result["bytes_reclaimed"] == size_before - size_after
    assert size_after < size_before


def test_integrity_check_passes_clean_db(fresh_db):
    from engine.db.info import integrity_check
    conn, _ = fresh_db
    result = integrity_check(conn)
    assert result["ok"] is True
    assert result["op"] == "integrity"
    assert result["output"] == ["ok"]
    assert result["duration_ms"] >= 0


def test_analyze_runs_without_error(fresh_db):
    from engine.db.info import analyze
    conn, _ = fresh_db
    result = analyze(conn)
    assert result["ok"] is True
    assert result["op"] == "analyze"
    assert result["duration_ms"] >= 0


def test_run_migrations_is_idempotent_on_migrated_db(fresh_db):
    from engine.db.info import run_migrations
    conn, _ = fresh_db
    # fresh_db fixture already migrated; second call should apply nothing.
    result = run_migrations(conn)
    assert result["ok"] is True
    assert result["op"] == "migrate"
    assert result["applied"] == []
    assert result["duration_ms"] >= 0
