"""Lazy-read routine — the ONE migration runtime per spec §4 Flow 5.

Covers all six branches:
1. No-op (row at CURRENT, original=NULL)
2. NULL-drop optimization (row at CURRENT, original=CURRENT → drop original)
3. Forward chain (row < CURRENT, no original)
4. Recovery exact catch-up (original exists, original.sv == CURRENT) — THE §4 BUG FIX
5. Still-drifted re-project (original.sv > CURRENT)
6. Deferred strict-validate failure → tolerant_drift_status='broken'
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from engine.db.lazy_migrate import lazy_migrate_row
from engine.db.migrations import migrate


@pytest.fixture
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    return conn


def _insert_module(conn, *, sv=1, original=None, drift="none", payload=None):
    conn.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, version, created_at, updated_at, schema_version, "
        "original_payload_json, tolerant_drift_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "m1", "wildcard", "n", "", None, "[]", 0,
            json.dumps(payload or {"id": "m1", "type": "wildcard"}),
            1, "now", "now", sv,
            json.dumps(original) if original else None,
            drift,
        ),
    )


def test_lazy_no_op(db: sqlite3.Connection) -> None:
    """Row at CURRENT, no original — return as-is, no write."""
    _insert_module(db, sv=1)
    db.commit()
    before = db.execute("SELECT payload FROM modules WHERE id='m1'").fetchone()["payload"]
    lazy_migrate_row(db, kind="module", row_id="m1", current_version=1, migrators={}, validators={})
    after = db.execute("SELECT payload FROM modules WHERE id='m1'").fetchone()["payload"]
    assert before == after


def test_lazy_null_drop(db: sqlite3.Connection) -> None:
    """Row at CURRENT, original.sv == CURRENT → NULL-drop optimization fires."""
    _insert_module(db, sv=1, original={"id":"m1","type":"wildcard","schema_version":1})
    db.commit()
    lazy_migrate_row(db, kind="module", row_id="m1", current_version=1, migrators={}, validators={})
    row = db.execute("SELECT original_payload_json FROM modules WHERE id='m1'").fetchone()
    assert row["original_payload_json"] is None


def test_lazy_forward_chain(db: sqlite3.Connection) -> None:
    """Row < CURRENT, no original → forward chain v1->v2."""
    _insert_module(db, sv=1)
    db.commit()

    def migrate_v1_to_v2(payload, _ctx):
        return {**payload, "added_in_v2": True}

    lazy_migrate_row(
        db, kind="module", row_id="m1", current_version=2,
        migrators={("module", 1): migrate_v1_to_v2},
        validators={},
    )
    row = db.execute("SELECT payload, schema_version FROM modules WHERE id='m1'").fetchone()
    payload = json.loads(row["payload"])
    assert payload.get("added_in_v2") is True
    assert row["schema_version"] == 2


def test_lazy_recovery_exact_catch_up(db: sqlite3.Connection) -> None:
    """THE BUG FIX FROM SPEC §4: recovery on exact catch-up.

    Row at v1 (tolerantly installed), original at v2.
    Extension catches up: CURRENT == 2 == original.schema_version.
    Routine MUST promote original into payload + NULL original.
    Without the 'base IS original' write-gate fix, this silently no-op'd
    in the old broken implementation.
    """
    _insert_module(
        db, sv=1,
        original={
            "id": "m1", "type": "wildcard",
            "payload": {"var_binding": "x", "options": []},
            "nsfw": True,
            "schema_version": 2,
        },
        drift="pending",
    )
    db.commit()

    def v2_strict(_payload):
        return True

    lazy_migrate_row(
        db, kind="module", row_id="m1", current_version=2,
        migrators={},
        validators={("module", 2, "wildcard"): v2_strict},
    )
    row = db.execute(
        "SELECT payload, schema_version, original_payload_json, tolerant_drift_status "
        "FROM modules WHERE id='m1'"
    ).fetchone()
    payload = json.loads(row["payload"])
    assert payload.get("nsfw") is True
    assert row["schema_version"] == 2
    assert row["original_payload_json"] is None
    assert row["tolerant_drift_status"] == "none"


def test_lazy_still_drifted_reproject(db: sqlite3.Connection) -> None:
    """Row at v1, original at v3, CURRENT==2 — re-project tolerantly to v2."""
    _insert_module(
        db, sv=1,
        original={
            "id": "m1", "type": "wildcard",
            "payload": {"var_binding": "x", "options": []},
            "nsfw": True, "tier": "epic",
            "schema_version": 3,
        },
        drift="pending",
    )
    db.commit()

    def tolerant_strip_to_v2(payload):
        out = dict(payload)
        out.pop("tier", None)
        return out

    lazy_migrate_row(
        db, kind="module", row_id="m1", current_version=2,
        migrators={},
        validators={("module", 2, "wildcard"): lambda _p: True},
        tolerant_strip={("module", 2, "wildcard"): tolerant_strip_to_v2},
    )
    row = db.execute(
        "SELECT payload, schema_version, original_payload_json, tolerant_drift_status "
        "FROM modules WHERE id='m1'"
    ).fetchone()
    payload = json.loads(row["payload"])
    assert payload.get("nsfw") is True
    assert "tier" not in payload
    assert row["schema_version"] == 2
    assert row["original_payload_json"] is not None
    assert row["tolerant_drift_status"] == "pending"


def test_lazy_broken_on_deferred_validation_failure(db: sqlite3.Connection) -> None:
    """Row at v1, original at v2 (catch-up), deferred strict-validate FAILS.
    Routine marks row tolerant_drift_status='broken', does NOT touch payload."""
    _insert_module(db, sv=1, original={"id":"m1","schema_version":2}, drift="pending")
    db.commit()
    before_payload = db.execute("SELECT payload FROM modules WHERE id='m1'").fetchone()["payload"]

    def v2_strict_FAIL(_payload):
        return False

    lazy_migrate_row(
        db, kind="module", row_id="m1", current_version=2,
        migrators={},
        validators={("module", 2, "wildcard"): v2_strict_FAIL},
    )
    row = db.execute(
        "SELECT payload, tolerant_drift_status FROM modules WHERE id='m1'"
    ).fetchone()
    assert row["payload"] == before_payload
    assert row["tolerant_drift_status"] == "broken"
