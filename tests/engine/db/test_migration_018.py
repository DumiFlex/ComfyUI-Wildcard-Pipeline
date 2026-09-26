"""Migration 018 — the Test Runner's saved scenarios table."""
import json

from engine.db.connection import get_connection
from engine.db.migrations import migrate


def _columns(conn, table):
    return {row[1]: row for row in conn.execute(f"PRAGMA table_info({table});").fetchall()}


def test_table_has_expected_columns(tmp_path):
    conn = get_connection(tmp_path / "s.db")
    migrate(conn)
    cols = _columns(conn, "test_scenarios")
    assert set(cols) == {
        "id", "name", "description", "is_pinned", "stack", "pins", "seeds",
        "output_var", "baseline", "last_run", "created_at", "updated_at",
    }
    conn.close()


def test_defaults_backfill_a_minimal_row(tmp_path):
    conn = get_connection(tmp_path / "d.db")
    migrate(conn)
    with conn:
        conn.execute(
            "INSERT INTO test_scenarios(id, name, created_at, updated_at) "
            "VALUES ('abcd1234', 'x', 't', 't');"
        )
    row = conn.execute("SELECT * FROM test_scenarios;").fetchone()
    assert json.loads(row["stack"]) == []
    assert json.loads(row["pins"]) == {}
    assert json.loads(row["seeds"]) == {"from": 0, "count": 100}
    assert row["is_pinned"] == 0
    assert row["baseline"] is None and row["last_run"] is None
    conn.close()


def test_rerun_is_idempotent(tmp_path):
    conn = get_connection(tmp_path / "i.db")
    migrate(conn)
    conn.execute("DELETE FROM migrations WHERE version = 18;")
    conn.commit()
    migrate(conn)
    assert "test_scenarios" in {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table';")
    }
    conn.close()
