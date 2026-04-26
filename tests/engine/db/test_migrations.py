"""Tests for the versioned migration runner."""
from engine.db.connection import get_connection
from engine.db.migrations import current_version, migrate


def test_initial_version_is_zero(tmp_path):
    conn = get_connection(tmp_path / "v.db")
    assert current_version(conn) == 0
    conn.close()


def test_migrate_creates_modules_and_categories_and_migrations(tmp_path):
    conn = get_connection(tmp_path / "m.db")
    migrate(conn)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table';"
        ).fetchall()
    }
    assert "modules" in tables
    assert "module_categories" in tables
    assert "migrations" in tables
    conn.close()


def test_migrate_records_version(tmp_path):
    conn = get_connection(tmp_path / "v2.db")
    migrate(conn)
    assert current_version(conn) == 1
    conn.close()


def test_migrate_is_idempotent(tmp_path):
    conn = get_connection(tmp_path / "i.db")
    migrate(conn)
    migrate(conn)
    assert current_version(conn) == 1
    conn.close()


def test_modules_table_has_expected_columns(tmp_path):
    conn = get_connection(tmp_path / "c.db")
    migrate(conn)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(modules);")}
    assert cols == {
        "id", "type", "name", "description", "category_id",
        "tags", "is_favorite", "payload", "version",
        "created_at", "updated_at",
    }
    conn.close()
