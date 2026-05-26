"""Migration 010 — option id backfill + constraint exception migration."""
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


def _raw_insert_wildcard(conn, mid, name, options):
    payload = {"sub_categories": [], "options": options}
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, snapshot_fingerprint, version, "
        "created_at, updated_at) "
        "VALUES(?, 'wildcard', ?, '', NULL, '[]', 0, ?, '', 1, '', '');",
        (mid, name, json.dumps(payload)),
    )


def _raw_insert_constraint(conn, mid, src_id, tgt_id, exceptions):
    payload = {
        "source_wildcard_id": src_id,
        "target_wildcard_id": tgt_id,
        "matrix": {},
        "exceptions": exceptions,
    }
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, snapshot_fingerprint, version, "
        "created_at, updated_at) "
        "VALUES(?, 'constraint', ?, '', NULL, '[]', 0, ?, '', 1, '', '');",
        (mid, f"c_{mid}", json.dumps(payload)),
    )


def _fetch_payload(conn, mid):
    cur = conn.cursor()
    cur.execute("SELECT payload FROM modules WHERE id = ?;", (mid,))
    return json.loads(cur.fetchone()["payload"])


def test_migration_backfills_option_ids(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM migrations WHERE version >= 10;")
    _raw_insert_wildcard(conn, "aaaaaaaa", "a", [
        {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
    ])

    migrate(conn)

    payload = _fetch_payload(conn, "aaaaaaaa")
    assert isinstance(payload["options"][0]["id"], str)
    assert len(payload["options"][0]["id"]) == 8


def test_migration_resolves_exception_strings_to_ids(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM migrations WHERE version >= 10;")
    _raw_insert_wildcard(conn, "aaaaaaaa", "src", [
        {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_wildcard(conn, "bbbbbbbb", "tgt", [
        {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_constraint(conn, "cccccccc", "aaaaaaaa", "bbbbbbbb", [
        {"source": "buzz", "target": "serene", "mode": "reduce", "factor": 0.5}
    ])

    migrate(conn)

    src = _fetch_payload(conn, "aaaaaaaa")
    tgt = _fetch_payload(conn, "bbbbbbbb")
    cons = _fetch_payload(conn, "cccccccc")

    expected_source_id = src["options"][0]["id"]
    expected_target_id = tgt["options"][0]["id"]

    assert cons["exceptions"][0]["source_id"] == expected_source_id
    assert cons["exceptions"][0]["target_id"] == expected_target_id
    # Legacy `source`/`target` value strings are preserved so the
    # runtime constraint resolver (which keys instance-override lookups
    # by value) keeps working. See migration 010 commentary.
    assert cons["exceptions"][0]["source"] == "buzz"
    assert cons["exceptions"][0]["target"] == "serene"


def test_migration_routes_unmatched_exception_to_broken_list(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM migrations WHERE version >= 10;")
    _raw_insert_wildcard(conn, "aaaaaaaa", "src", [
        {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_wildcard(conn, "bbbbbbbb", "tgt", [
        {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_constraint(conn, "cccccccc", "aaaaaaaa", "bbbbbbbb", [
        {"source": "missing_option", "target": "serene", "mode": "reduce", "factor": 0.5}
    ])

    migrate(conn)

    cons = _fetch_payload(conn, "cccccccc")
    assert cons["exceptions"] == []
    assert len(cons["broken_exceptions"]) == 1
    assert cons["broken_exceptions"][0]["reason"].startswith("source_value not found")


def test_migration_routes_ambiguous_match_to_broken_list(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM migrations WHERE version >= 10;")
    _raw_insert_wildcard(conn, "aaaaaaaa", "src", [
        {"value": "dup", "weight": 1, "sub_category": None, "probability": 1.0},
        {"value": "dup", "weight": 1, "sub_category": None, "probability": 1.0},
    ])
    _raw_insert_wildcard(conn, "bbbbbbbb", "tgt", [
        {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_constraint(conn, "cccccccc", "aaaaaaaa", "bbbbbbbb", [
        {"source": "dup", "target": "serene", "mode": "reduce", "factor": 0.5}
    ])

    migrate(conn)

    cons = _fetch_payload(conn, "cccccccc")
    assert cons["exceptions"] == []
    assert any("ambiguous" in b["reason"] for b in cons["broken_exceptions"])


def test_migration_preserves_already_migrated_exceptions(conn):
    """If an exception already has source_id/target_id, leave it alone."""
    cur = conn.cursor()
    cur.execute("DELETE FROM migrations WHERE version >= 10;")
    _raw_insert_wildcard(conn, "aaaaaaaa", "src", [
        {"id": "opt_aaaa", "value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_wildcard(conn, "bbbbbbbb", "tgt", [
        {"id": "opt_bbbb", "value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
    ])
    _raw_insert_constraint(conn, "cccccccc", "aaaaaaaa", "bbbbbbbb", [
        {"source_id": "opt_aaaa", "target_id": "opt_bbbb", "mode": "reduce", "factor": 0.5}
    ])

    migrate(conn)

    cons = _fetch_payload(conn, "cccccccc")
    assert cons["exceptions"] == [
        {"source_id": "opt_aaaa", "target_id": "opt_bbbb", "mode": "reduce", "factor": 0.5}
    ]
    assert "broken_exceptions" not in cons or cons.get("broken_exceptions") == []
