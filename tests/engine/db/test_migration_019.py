"""Migration 019: negative_template column on saved prompt templates."""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

from engine.db.migrations import migrate
from engine.db.repositories import TemplateRepository


@pytest.fixture
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    migrate(conn)
    return conn


def test_019_adds_negative_template(db: sqlite3.Connection) -> None:
    cols = {row["name"]: row for row in db.execute("PRAGMA table_info(templates)")}
    assert "negative_template" in cols
    # Nullable, no default: NULL means "saved before negatives existed".
    assert cols["negative_template"]["notnull"] == 0
    assert cols["negative_template"]["dflt_value"] is None


def test_019_existing_rows_backfill_null(db: sqlite3.Connection) -> None:
    db.execute(
        "INSERT INTO templates(id, name, description, category_id, tags, "
        "is_favorite, template_string, created_at, updated_at) "
        "VALUES('aabbccdd','t','',NULL,'[]',0,'$a','2026-01-01','2026-01-01')"
    )
    db.commit()
    row = TemplateRepository(db).get("aabbccdd")
    assert row["negative_template"] is None
    assert row["template_string"] == "$a"


def test_019_idempotent_rerun(db: sqlite3.Connection) -> None:
    before = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    migrate(db)
    after = db.execute("SELECT MAX(version) FROM migrations").fetchone()[0]
    assert before == after
    # The column gate makes a direct re-run safe too.
    path = (
        Path(__file__).resolve().parents[3]
        / "engine" / "db" / "migrations_sql" / "019_template_negative.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_019_test", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.up(db)


def test_019_repository_round_trip(db: sqlite3.Connection) -> None:
    repo = TemplateRepository(db)
    t = repo.create(name="t", template_string="$hair", negative_template="lowres, $negatives")
    assert t["negative_template"] == "lowres, $negatives"
    # Untouched on an update that does not name it.
    assert repo.update(t["id"], name="t2")["negative_template"] == "lowres, $negatives"
    # An empty string is a real (blank) negative, distinct from NULL.
    assert repo.update(t["id"], negative_template="")["negative_template"] == ""
    assert repo.update(t["id"], negative_template=None)["negative_template"] is None
    assert repo.create(name="old")["negative_template"] is None
