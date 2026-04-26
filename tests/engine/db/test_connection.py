"""Tests for SQLite connection factory."""
import sqlite3

from engine.db.connection import get_connection, resolve_db_path


def test_resolve_db_path_uses_override(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "custom.db"))
    assert resolve_db_path() == tmp_path / "custom.db"


def test_resolve_db_path_default_under_user_dir(tmp_path, monkeypatch):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.setenv("COMFYUI_USER_DIR", str(tmp_path))
    assert resolve_db_path() == tmp_path / "wildcard-pipeline.db"


def test_get_connection_returns_sqlite3_connection(tmp_path):
    conn = get_connection(tmp_path / "test.db")
    assert isinstance(conn, sqlite3.Connection)
    conn.close()


def test_get_connection_enables_wal_mode(tmp_path):
    conn = get_connection(tmp_path / "wal.db")
    mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
    assert mode == "wal"
    conn.close()


def test_get_connection_enforces_foreign_keys(tmp_path):
    conn = get_connection(tmp_path / "fk.db")
    fk = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
    assert fk == 1
    conn.close()


def test_get_connection_creates_parent_dir(tmp_path):
    target = tmp_path / "nested" / "deeper" / "wp.db"
    conn = get_connection(target)
    assert target.parent.exists()
    conn.close()
