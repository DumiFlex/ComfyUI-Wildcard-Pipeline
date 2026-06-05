"""Migration 014: ALTERs modules + bundles with schema_version, original_payload_json,
tolerant_drift_status, schema_migrated_at; backfills schema_version=1 on existing rows.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from engine.db.migrations import migrate


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    migrate(conn)
    return conn


def test_014_adds_module_columns(db: sqlite3.Connection) -> None:
    cols = {row["name"] for row in db.execute("PRAGMA table_info(modules)")}
    assert "schema_version" in cols
    assert "original_payload_json" in cols
    assert "tolerant_drift_status" in cols
    assert "schema_migrated_at" in cols


def test_014_adds_bundle_columns(db: sqlite3.Connection) -> None:
    cols = {row["name"] for row in db.execute("PRAGMA table_info(bundles)")}
    assert "schema_version" in cols
    assert "original_payload_json" in cols
    assert "tolerant_drift_status" in cols
    assert "schema_migrated_at" in cols


def test_014_backfills_schema_version_one_on_existing_rows(
    db: sqlite3.Connection,
) -> None:
    """Pre-existing module rows get schema_version=1 (the implicit baseline)."""
    db.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, version, created_at, updated_at) "
        "VALUES('m1','wildcard','m','',NULL,'[]',0,'{}',1,'2026-01-01','2026-01-01')"
    )
    db.commit()
    row = db.execute(
        "SELECT schema_version, tolerant_drift_status FROM modules WHERE id='m1'"
    ).fetchone()
    assert row["schema_version"] == 1
    assert row["tolerant_drift_status"] == "none"


def test_014_idempotent_rerun(db: sqlite3.Connection) -> None:
    """Re-running migrate() doesn't reapply 014 (migrations table guards it)."""
    before = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    migrate(db)
    after = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    assert before == after
