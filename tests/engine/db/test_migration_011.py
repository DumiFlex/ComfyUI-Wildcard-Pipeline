"""Migration 011 — cleaner_presets table + built-in intensity seed."""
import json
import sqlite3

import pytest

from engine.db.migrations import migrate


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    yield c
    c.close()


def test_creates_cleaner_presets_table(conn):
    cur = conn.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name='cleaner_presets'"
    )
    assert cur.fetchone() is not None


def test_seeds_three_builtin_presets(conn):
    rows = conn.execute(
        "SELECT id, name, is_builtin FROM cleaner_presets ORDER BY name"
    ).fetchall()
    names = [r["name"] for r in rows]
    assert names == ["aggressive", "balanced", "gentle"]
    assert all(r["is_builtin"] == 1 for r in rows)


def test_seed_is_idempotent():
    """Running migrate twice doesn't double-seed."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    # Roll back the migrations table entry so the runner re-runs 011.
    c.execute("DELETE FROM migrations WHERE version = 11;")
    migrate(c)
    n = c.execute("SELECT COUNT(*) AS c FROM cleaner_presets").fetchone()["c"]
    assert n == 3
    c.close()


def test_seeded_payload_matches_intensity_map(conn):
    from engine.cleaner.pipeline import INTENSITY_TO_RULES

    rows = conn.execute("SELECT name, payload FROM cleaner_presets").fetchall()
    assert {r["name"] for r in rows} == set(INTENSITY_TO_RULES.keys())
    for r in rows:
        payload = json.loads(r["payload"])
        assert payload["intensity"] == r["name"]
        assert payload["rules_override"] == {}
        assert payload["blocklist"] == {"kind": "list", "entries": []}


def test_index_present(conn):
    """The name index is what list queries hit."""
    row = conn.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='index' AND name='idx_cleaner_presets_name'"
    ).fetchone()
    assert row is not None
