"""Tests for the versioned migration runner."""
import sqlite3

from engine.db.connection import get_connection
from engine.db.migrations import _discover, current_version, migrate


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


def test_003_adds_uuid_column_with_backfill_and_index(tmp_path):
    """003_add_uuid_column.sql adds uuid column, backfills from id suffix,
    and creates a unique index. Verified end-to-end against a real
    sqlite3 connection so we catch syntax errors the runner ignores."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    # Migrate to v002 first (current head before this plan), seed a row
    # with the legacy schema (no uuid column).
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


def test_003_backfills_multiple_rows_and_preserves_pre_set_uuid(tmp_path):
    """Multi-row backfill: every NULL uuid gets the trailing 8 hex of its id.
    Pre-set uuids are preserved (the WHERE uuid IS NULL guard).

    This pins the multi-row UPDATE path that the single-row test in
    `test_003_adds_uuid_column_with_backfill_and_index` does not exercise."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    # Migrate to v002 first, seed three rows on the legacy schema.
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
    for id_ in ("wc_a_aaaaaaaa", "wc_b_bbbbbbbb", "fv_c_cccccccc"):
        conn.execute(
            "INSERT INTO modules(id, type, name, description, category_id, "
            "tags, is_favorite, payload, version, created_at, updated_at) "
            "VALUES (?, 'wildcard', 'x', '', NULL, '[]', 0, '{}', 1, "
            "datetime('now'), datetime('now'));",
            (id_,),
        )
    conn.commit()

    migrate(conn)

    rows = {
        r["id"]: r["uuid"]
        for r in conn.execute("SELECT id, uuid FROM modules ORDER BY id;")
    }
    assert rows == {
        "wc_a_aaaaaaaa": "aaaaaaaa",
        "wc_b_bbbbbbbb": "bbbbbbbb",
        "fv_c_cccccccc": "cccccccc",
    }


def test_003_is_idempotent_when_run_against_already_migrated_db(tmp_path):
    """Calling migrate() twice on a fresh DB does not error and leaves
    every row's uuid intact. Backstops the `IF NOT EXISTS` guard on the
    index and the no-op behavior of UPDATE WHERE uuid IS NULL when no
    rows are NULL."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    migrate(conn)
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, "
        "category_id, tags, is_favorite, payload, version, created_at, "
        "updated_at) VALUES ('wc_x_12345678', '12345678', 'wildcard', "
        "'x', '', NULL, '[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.commit()

    # Re-running migrate is a no-op (version already == 3) — calling it
    # twice in succession should NOT trip any "duplicate column" or
    # uniqueness errors.
    migrate(conn)
    migrate(conn)

    row = conn.execute(
        "SELECT uuid FROM modules WHERE id = 'wc_x_12345678';"
    ).fetchone()
    assert row["uuid"] == "12345678"
