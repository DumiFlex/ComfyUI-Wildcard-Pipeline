"""Real-shape fixture tests for subcategory rename + delete fixers.

The pre-existing test suite for fixers passes the wrong field name
(`opt["sub_categories"]` — plural array) which masked a schema bug
where the fixers silently no-op'd against real runtime data. These
tests construct wildcards via `ModuleRepository.create` so the data
matches what the server actually stores (singular `opt.sub_category`
plus top-level `payload.sub_categories` list).

Regression: 2026-05-24 live QA on cascade-edit-indicators v1.
"""
import sqlite3

import pytest

from engine.cascade.orchestrator import apply_cascade
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    yield c
    c.close()


def _create_wildcard(conn, name, sub_categories, options):
    repo = ModuleRepository(conn)
    return repo.create(
        type="wildcard",
        name=name,
        description="",
        category_id=None,
        tags=[],
        payload={"sub_categories": sub_categories, "options": options},
    )


def test_subcat_rename_updates_top_level_list(conn):
    w = _create_wildcard(
        conn,
        "mood",
        sub_categories=["positive", "negative"],
        options=[
            {"value": "serene", "weight": 1, "sub_category": "positive", "probability": 1.0},
            {"value": "tense", "weight": 1, "sub_category": "negative", "probability": 1.0},
        ],
    )
    res = apply_cascade(conn, {
        "kind": "subcategory", "id": w["id"], "action": "rename",
        "cascade_refs": True, "new_name": "good",
        "extra": {"subcat_name": "positive"},
    })
    assert res["ok"], res

    updated = ModuleRepository(conn).get(w["id"])
    assert "good" in updated["payload"]["sub_categories"]
    assert "positive" not in updated["payload"]["sub_categories"]


def test_subcat_rename_updates_option_assignments(conn):
    w = _create_wildcard(
        conn,
        "mood",
        sub_categories=["positive", "negative"],
        options=[
            {"value": "serene", "weight": 1, "sub_category": "positive", "probability": 1.0},
            {"value": "tense", "weight": 1, "sub_category": "negative", "probability": 1.0},
        ],
    )
    apply_cascade(conn, {
        "kind": "subcategory", "id": w["id"], "action": "rename",
        "cascade_refs": True, "new_name": "good",
        "extra": {"subcat_name": "positive"},
    })

    updated = ModuleRepository(conn).get(w["id"])
    assignments = [o["sub_category"] for o in updated["payload"]["options"]]
    assert assignments == ["good", "negative"]


def test_subcat_delete_removes_from_top_level_and_options(conn):
    w = _create_wildcard(
        conn,
        "mood",
        sub_categories=["positive", "negative"],
        options=[
            {"value": "serene", "weight": 1, "sub_category": "positive", "probability": 1.0},
            {"value": "tense", "weight": 1, "sub_category": "negative", "probability": 1.0},
        ],
    )
    res = apply_cascade(conn, {
        "kind": "subcategory", "id": w["id"], "action": "delete",
        "cascade_refs": True, "extra": {"subcat_name": "positive"},
    })
    assert res["ok"]

    updated = ModuleRepository(conn).get(w["id"])
    assert updated["payload"]["sub_categories"] == ["negative"]
    assignments = [o["sub_category"] for o in updated["payload"]["options"]]
    assert assignments == [None, "negative"]


def test_subcat_rename_optout_updates_source_only(conn):
    w = _create_wildcard(
        conn,
        "mood",
        sub_categories=["positive", "negative"],
        options=[
            {"value": "serene", "weight": 1, "sub_category": "positive", "probability": 1.0},
        ],
    )
    res = apply_cascade(conn, {
        "kind": "subcategory", "id": w["id"], "action": "rename",
        "cascade_refs": False, "new_name": "good",
        "extra": {"subcat_name": "positive"},
    })
    assert res["ok"]

    updated = ModuleRepository(conn).get(w["id"])
    assert updated["payload"]["sub_categories"] == ["good", "negative"]
    assert updated["payload"]["options"][0]["sub_category"] == "good"
