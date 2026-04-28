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
    # Keep this assertion in sync with the highest-numbered migration in
    # ``engine/db/migrations_sql``.
    assert current_version(conn) == 3
    conn.close()


def test_migrate_is_idempotent(tmp_path):
    conn = get_connection(tmp_path / "i.db")
    migrate(conn)
    before = current_version(conn)
    migrate(conn)
    assert current_version(conn) == before
    conn.close()


def test_modules_table_has_expected_columns(tmp_path):
    conn = get_connection(tmp_path / "c.db")
    migrate(conn)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(modules);")}
    assert cols == {
        "id", "type", "name", "description", "category_id",
        "tags", "is_favorite", "payload", "version",
        "created_at", "updated_at", "uuid",
    }
    conn.close()


import sqlite3  # noqa: E402 — stdlib; placed here to keep patch minimal


def test_003_adds_uuid_column_with_backfill_and_index(tmp_path):
    """003_add_uuid_column.sql adds uuid column, backfills from id suffix,
    and creates a unique index. Verified end-to-end against a real
    sqlite3 connection so we catch syntax errors the runner ignores."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    # Migrate to v002 first (current head before this plan), seed a row
    # with the legacy schema (no uuid column).
    from engine.db.migrations import _discover
    pairs = _discover()
    for version, sql_file in pairs:
        if version >= 3:
            break
        with conn:
            conn.executescript(sql_file.read_text())
            conn.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) "
                "VALUES (?, datetime('now'));",
                (version,),
            )
    conn.execute(
        "INSERT INTO modules(id, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('wc_color_aabbccdd', 'wildcard', 'color', '', NULL, "
        "'[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.commit()

    # Run full migrate (will pick up 003)
    migrate(conn)

    # Column exists
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(modules);")}
    assert "uuid" in cols

    # Backfill correct
    row = conn.execute(
        "SELECT uuid FROM modules WHERE id = 'wc_color_aabbccdd';"
    ).fetchone()
    assert row["uuid"] == "aabbccdd"

    # Unique index present
    idx = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index';"
    )}
    assert "idx_modules_uuid" in idx
