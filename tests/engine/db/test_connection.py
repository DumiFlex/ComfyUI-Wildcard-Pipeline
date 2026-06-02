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


def test_get_connection_row_factory_supports_name_access(tmp_path):
    conn = get_connection(tmp_path / "row.db")
    conn.execute("CREATE TABLE t (val INTEGER);")
    conn.execute("INSERT INTO t VALUES (42);")
    row = conn.execute("SELECT val FROM t;").fetchone()
    assert row["val"] == 42
    conn.close()


def test_resolve_db_path_prefers_comfyui_user_dir(monkeypatch, tmp_path):
    """When ComfyUI's user directory is detected AND no sidecar
    preference overrides it, the resolver should land in
    `<ComfyUI>/user/wildcard-pipeline.db`."""
    from engine.db import connection as conn_mod

    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    # Fix the detected ComfyUI user dir to a clean tmp path so we
    # don't depend on whatever the path-traversal finds in the host
    # ComfyUI install. Also stub the sidecar loader so the test
    # doesn't depend on whatever db-config.json sits in the plugin
    # dir (and so it returns the default "user" path, not "global"
    # or "root").
    fake_comfy_user = tmp_path / "comfy-user"
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_api", lambda: None)
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_path", lambda: fake_comfy_user)
    monkeypatch.setattr(conn_mod, "_load_sidecar", lambda: {})
    result = resolve_db_path()
    assert result == fake_comfy_user / "wildcard-pipeline.db"


def test_resolve_db_path_falls_back_to_home_when_no_comfyui_root(monkeypatch):
    """Standalone install (no ComfyUI on the path). Both detectors
    return None; we fall through to ~/.comfyui (reported as "global"
    by the source-aware resolver)."""
    from pathlib import Path

    from engine.db import connection as conn_mod

    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_api", lambda: None)
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_path", lambda: None)
    monkeypatch.setattr(conn_mod, "_load_sidecar", lambda: {})
    result = resolve_db_path()
    assert result == Path.home() / ".comfyui" / "wildcard-pipeline.db"
