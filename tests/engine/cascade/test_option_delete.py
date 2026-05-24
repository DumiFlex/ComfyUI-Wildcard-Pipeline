"""Tests for `(option, delete)` cascade pair."""
import sqlite3

import pytest

from engine.cascade.scan import scan_affected
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    yield c
    c.close()


def test_scan_option_delete_finds_constraint_exceptions(conn):
    repo = ModuleRepository(conn)
    src = repo.create(
        type="wildcard", name="hair", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    tgt = repo.create(
        type="wildcard", name="mood", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    src_opt = src["payload"]["options"][0]["id"]
    tgt_opt = tgt["payload"]["options"][0]["id"]

    repo.create(
        type="constraint", name="hair_x_mood", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": src["id"],
            "target_wildcard_id": tgt["id"],
            "matrix": {},
            "exceptions": [
                {
                    "source": "buzz", "target": "serene",
                    "source_id": src_opt, "target_id": tgt_opt,
                    "mode": "reduce", "factor": 0.5,
                }
            ],
        },
    )

    affected = scan_affected(
        conn, kind="option", id=src_opt, action="delete",
        extra={"wildcard_id": src["id"]},
    )
    assert len(affected) == 1
    assert affected[0]["kind"] == "constraint"
    assert affected[0]["name"] == "hair_x_mood"
    assert "exceptions" in affected[0]["ref_path"]


def test_scan_option_delete_finds_target_axis_too(conn):
    repo = ModuleRepository(conn)
    src = repo.create(
        type="wildcard", name="a", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "x", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    tgt = repo.create(
        type="wildcard", name="b", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "y", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    src_opt = src["payload"]["options"][0]["id"]
    tgt_opt = tgt["payload"]["options"][0]["id"]
    repo.create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": src["id"], "target_wildcard_id": tgt["id"],
            "matrix": {},
            "exceptions": [
                {
                    "source": "x", "target": "y",
                    "source_id": src_opt, "target_id": tgt_opt,
                    "mode": "reduce", "factor": 0.5,
                }
            ],
        },
    )

    affected = scan_affected(
        conn, kind="option", id=tgt_opt, action="delete",
        extra={"wildcard_id": tgt["id"]},
    )
    assert len(affected) == 1
    assert affected[0]["ref_path"].endswith("target_id")


def test_option_delete_removes_option_and_constraint_exceptions(conn):
    from engine.cascade.orchestrator import apply_cascade

    repo = ModuleRepository(conn)
    src = repo.create(
        type="wildcard", name="hair", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0},
            {"value": "crew", "weight": 1, "sub_category": None, "probability": 1.0},
        ]},
    )
    src_opt = src["payload"]["options"][0]["id"]
    other_opt = src["payload"]["options"][1]["id"]
    tgt = repo.create(
        type="wildcard", name="mood", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    tgt_opt = tgt["payload"]["options"][0]["id"]
    cons = repo.create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": src["id"],
            "target_wildcard_id": tgt["id"],
            "matrix": {},
            "exceptions": [
                {
                    "source": "buzz", "target": "serene",
                    "source_id": src_opt, "target_id": tgt_opt,
                    "mode": "reduce", "factor": 0.5,
                },
                {
                    "source": "crew", "target": "serene",
                    "source_id": other_opt, "target_id": tgt_opt,
                    "mode": "boost", "factor": 1.5,
                },
            ],
        },
    )

    res = apply_cascade(conn, {
        "kind": "option", "id": src_opt, "action": "delete",
        "cascade_refs": True, "extra": {"wildcard_id": src["id"]},
    })
    assert res["ok"], res

    src_after = repo.get(src["id"])
    assert [o["id"] for o in src_after["payload"]["options"]] == [other_opt]

    cons_after = repo.get(cons["id"])
    assert len(cons_after["payload"]["exceptions"]) == 1
    assert cons_after["payload"]["exceptions"][0]["source_id"] == other_opt


def test_option_delete_undo_restores_option_and_exceptions(conn):
    from engine.cascade.orchestrator import apply_cascade
    from engine.cascade.undo import undo_cascade

    repo = ModuleRepository(conn)
    src = repo.create(
        type="wildcard", name="hair", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    src_opt = src["payload"]["options"][0]["id"]
    tgt = repo.create(
        type="wildcard", name="mood", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "serene", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    tgt_opt = tgt["payload"]["options"][0]["id"]
    cons = repo.create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": src["id"],
            "target_wildcard_id": tgt["id"],
            "matrix": {},
            "exceptions": [
                {
                    "source": "buzz", "target": "serene",
                    "source_id": src_opt, "target_id": tgt_opt,
                    "mode": "reduce", "factor": 0.5,
                }
            ],
        },
    )

    res = apply_cascade(conn, {
        "kind": "option", "id": src_opt, "action": "delete",
        "cascade_refs": True, "extra": {"wildcard_id": src["id"]},
    })
    undo_res = undo_cascade(conn, res["undo_entry_id"])
    assert undo_res["ok"], undo_res

    src_after = repo.get(src["id"])
    assert len(src_after["payload"]["options"]) == 1
    assert src_after["payload"]["options"][0]["id"] == src_opt
    cons_after = repo.get(cons["id"])
    assert len(cons_after["payload"]["exceptions"]) == 1


def test_scan_option_delete_returns_empty_for_unused(conn):
    repo = ModuleRepository(conn)
    src = repo.create(
        type="wildcard", name="a", description="", category_id=None, tags=[],
        payload={"sub_categories": [], "options": [
            {"value": "x", "weight": 1, "sub_category": None, "probability": 1.0}
        ]},
    )
    src_opt = src["payload"]["options"][0]["id"]
    affected = scan_affected(
        conn, kind="option", id=src_opt, action="delete",
        extra={"wildcard_id": src["id"]},
    )
    assert affected == []
