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
    assert current_version(conn) == 5
    conn.close()


def test_migrate_creates_bundles_table_with_expected_columns(tmp_path):
    """Migration 005 adds the bundles library table."""
    conn = get_connection(tmp_path / "b.db")
    migrate(conn)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table';"
        ).fetchall()
    }
    assert "bundles" in tables
    cols = {row[1] for row in conn.execute("PRAGMA table_info(bundles);")}
    assert cols == {
        "id", "name", "description", "color", "category_id",
        "tags", "is_favorite", "children", "payload_hash",
        "version", "created_at", "updated_at",
    }
    conn.close()


def test_migrate_is_idempotent(tmp_path):
    conn = get_connection(tmp_path / "i.db")
    migrate(conn)
    before = current_version(conn)
    migrate(conn)
    assert current_version(conn) == before
    conn.close()


def test_modules_table_has_expected_columns(tmp_path):
    """End-state schema, post all migrations.

    Migration 004 dropped the standalone `uuid` column — `id` IS the
    canonical 8-hex uuid now."""
    conn = get_connection(tmp_path / "c.db")
    migrate(conn)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(modules);")}
    assert cols == {
        "id", "type", "name", "description", "category_id",
        "tags", "is_favorite", "payload", "version",
        "created_at", "updated_at",
    }
    conn.close()


def _migrate_up_to(conn: sqlite3.Connection, max_version: int) -> None:
    """Apply migrations 001..max_version (inclusive) to a fresh DB.

    Used by intermediate-state tests below — migration 003 is meant
    to be exercised in isolation since 004 supersedes it. We can't
    rely on the public `migrate()` because it always migrates to head."""
    for version, mig_file in _discover():
        if version > max_version:
            break
        if mig_file.suffix == ".py":
            from engine.db.migrations import _load_py_migration
            up = _load_py_migration(mig_file)
            with conn:
                up(conn)
                conn.execute(
                    "INSERT INTO migrations(version, applied_at) VALUES(?, datetime('now'));",
                    (version,),
                )
        else:
            sql = mig_file.read_text()
            with conn:
                conn.executescript(sql)
                conn.execute(
                    "INSERT OR IGNORE INTO migrations(version, applied_at) "
                    "VALUES(?, datetime('now'));",
                    (version,),
                )


def test_004_unifies_id_with_uuid_and_drops_uuid_column(tmp_path):
    """Migration 004 rewrites every `modules.id` to its 8-hex `uuid`
    suffix and removes the standalone uuid column. Verified end-to-end
    against a real sqlite3 connection so we catch syntax errors the
    runner ignores."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    # Stop at 003 — that's the legacy state with the dual id+uuid model.
    _migrate_up_to(conn, 3)
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('wc_color_aabbccdd', 'aabbccdd', 'wildcard', 'color', '', NULL, "
        "'[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.commit()

    # Now apply 004 (and subsequent migrations, if any).
    migrate(conn)

    cols = {r["name"] for r in conn.execute("PRAGMA table_info(modules);")}
    assert "uuid" not in cols, "004 should drop the standalone uuid column"

    row = conn.execute("SELECT id FROM modules;").fetchone()
    assert row["id"] == "aabbccdd", "id should be rewritten to its 8-hex form"


def test_004_rewrites_pipeline_step_module_id_cross_refs(tmp_path):
    """Migration 004 must rewrite cross-refs inside payload JSON, not
    just the id column. A pipeline whose step references the legacy
    slug `wc_color_aabbccdd` must end up referencing `aabbccdd`."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    _migrate_up_to(conn, 3)
    # Two rows: a wildcard that will be referenced, and a pipeline
    # that points at it via the legacy slug form.
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('wc_color_aabbccdd', 'aabbccdd', 'wildcard', 'color', '', NULL, "
        "'[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('pl_main_11223344', '11223344', 'pipeline', 'main', '', NULL, "
        "'[]', 0, ?, 1, datetime('now'), datetime('now'));",
        ('{"steps":[{"module_id":"wc_color_aabbccdd","enabled":true}]}',),
    )
    conn.commit()

    migrate(conn)

    import json
    row = conn.execute(
        "SELECT payload FROM modules WHERE id = '11223344';"
    ).fetchone()
    payload = json.loads(row["payload"])
    assert payload["steps"][0]["module_id"] == "aabbccdd"


def test_004_rewrites_constraint_source_target_cross_refs(tmp_path):
    """Constraint payloads carry source/target wildcard ids — they
    have to be rewritten alongside pipeline step ids."""
    db = tmp_path / "lib.db"
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    _migrate_up_to(conn, 3)
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('wc_outfit_a1a1a1a1', 'a1a1a1a1', 'wildcard', 'outfit', '', NULL, "
        "'[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('wc_color_b2b2b2b2', 'b2b2b2b2', 'wildcard', 'color', '', NULL, "
        "'[]', 0, '{}', 1, datetime('now'), datetime('now'));"
    )
    conn.execute(
        "INSERT INTO modules(id, uuid, type, name, description, category_id, "
        "tags, is_favorite, payload, version, created_at, updated_at) "
        "VALUES ('ct_x_c3c3c3c3', 'c3c3c3c3', 'constraint', 'x', '', NULL, "
        "'[]', 0, ?, 1, datetime('now'), datetime('now'));",
        (
            '{"source_wildcard_id":"wc_outfit_a1a1a1a1",'
            '"target_wildcard_id":"wc_color_b2b2b2b2"}',
        ),
    )
    conn.commit()

    migrate(conn)

    import json
    row = conn.execute(
        "SELECT payload FROM modules WHERE id = 'c3c3c3c3';"
    ).fetchone()
    payload = json.loads(row["payload"])
    assert payload["source_wildcard_id"] == "a1a1a1a1"
    assert payload["target_wildcard_id"] == "b2b2b2b2"


def test_004_is_idempotent(tmp_path):
    """Running 004 twice (via re-running migrate on an already-migrated
    DB) must not error or re-mangle ids.

    Version assertion uses the head migration number — keep in sync
    when new migrations land.
    """
    conn = get_connection(tmp_path / "i.db")
    migrate(conn)
    migrate(conn)  # second call should be a no-op
    assert current_version(conn) == 5
    conn.close()
