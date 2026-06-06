"""Migration 016 auto-migrates stale v1 rows to v2 on boot (bulk lazy)."""
import json
import sqlite3

import pytest

from engine.db.migrations import current_version, migrate


@pytest.fixture
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)  # full chain, incl. 016 (no-op on the empty DB)
    return conn


def _insert_v1_wildcard(conn: sqlite3.Connection, payload: dict) -> None:
    conn.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, version, created_at, updated_at, schema_version, "
        "original_payload_json, tolerant_drift_status) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("w1", "wildcard", "n", "", None, "[]", 0, json.dumps(payload),
         1, "now", "now", 1, None, "none"),
    )
    conn.commit()


def test_016_discovered_and_runs_clean(db: sqlite3.Connection) -> None:
    assert current_version(db) >= 16


def test_016_bulk_migrates_v1_wildcard_row(db: sqlite3.Connection) -> None:
    _insert_v1_wildcard(db, {"sub_categories": ["warm tones"], "options": [
        {"id": "o", "value": "x", "weight": 1, "sub_category": "warm tones"}]})
    # Rewind the migration ledger so migrate() re-runs 016 against the row.
    db.execute("DELETE FROM migrations WHERE version >= 16")
    db.commit()
    migrate(db)
    row = db.execute(
        "SELECT payload, schema_version FROM modules WHERE id='w1'"
    ).fetchone()
    p = json.loads(row["payload"])
    assert row["schema_version"] == 2
    assert p["sub_categories"] == ["warm_tones"]
    assert p["options"][0]["sub_categories"] == ["warm_tones"]
    assert "sub_category" not in p["options"][0]
