"""Migration 015: content_rating column on modules + bundles."""
from __future__ import annotations

import sqlite3

import pytest

from engine.db.migrations import migrate


@pytest.fixture
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    migrate(conn)
    return conn


def test_015_adds_module_content_rating(db: sqlite3.Connection) -> None:
    cols = {row["name"] for row in db.execute("PRAGMA table_info(modules)")}
    assert "content_rating" in cols


def test_015_adds_bundle_content_rating(db: sqlite3.Connection) -> None:
    cols = {row["name"] for row in db.execute("PRAGMA table_info(bundles)")}
    assert "content_rating" in cols


def test_015_default_safe_on_backfill(db: sqlite3.Connection) -> None:
    """Pre-existing rows get content_rating='safe' on column add."""
    db.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, version, created_at, updated_at) "
        "VALUES('m1','wildcard','m','',NULL,'[]',0,'{}',1,'2026-01-01','2026-01-01')"
    )
    db.execute(
        "INSERT INTO bundles(id, name, description, color, category_id, tags, "
        "is_favorite, children, payload_hash, version, created_at, updated_at) "
        "VALUES('b1','b','',NULL,NULL,'[]',0,'[]','aaaaaaaa',1,"
        "'2026-01-01','2026-01-01')"
    )
    db.commit()
    m_rating = db.execute(
        "SELECT content_rating FROM modules WHERE id='m1'"
    ).fetchone()["content_rating"]
    b_rating = db.execute(
        "SELECT content_rating FROM bundles WHERE id='b1'"
    ).fetchone()["content_rating"]
    assert m_rating == "safe"
    assert b_rating == "safe"


def test_015_idempotent_rerun(db: sqlite3.Connection) -> None:
    before = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    migrate(db)
    after = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    assert before == after


def test_015_accepts_nsfw_value(db: sqlite3.Connection) -> None:
    """Direct INSERT with content_rating='nsfw' round-trips."""
    db.execute(
        "INSERT INTO modules(id, type, name, description, category_id, tags, "
        "is_favorite, payload, version, created_at, updated_at, content_rating) "
        "VALUES('m2','wildcard','m','',NULL,'[]',0,'{}',1,"
        "'2026-01-01','2026-01-01','nsfw')"
    )
    db.commit()
    rating = db.execute(
        "SELECT content_rating FROM modules WHERE id='m2'"
    ).fetchone()["content_rating"]
    assert rating == "nsfw"
