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
