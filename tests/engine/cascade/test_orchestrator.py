"""End-to-end orchestrator tests."""
import pytest

from engine.cascade.orchestrator import apply_cascade
from engine.db.repositories import (
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
)


def test_dry_run_returns_affected_without_mutating(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="x", description="", category_id=None,
                    tags=[], payload={"options": []})
    other = mod.create(type="wildcard", name="y", description="", category_id=None,
                       tags=[], payload={"options": []})
    c = mod.create(type="constraint", name="c1", description="", category_id=None,
                   tags=[], payload={"source_wildcard_id": wc["id"],
                                     "target_wildcard_id": other["id"],
                                     "matrix": {}, "exceptions": []})

    resp = apply_cascade(wp_db, {
        "kind": "wildcard", "id": wc["id"], "action": "delete", "dry_run": True,
    })

    assert resp["ok"] is True
    assert resp["affected_count"] == 1
    assert any(a["id"] == c["id"] for a in resp["affected_entities"])
    # No mutation.
    assert mod.get(c["id"]) is not None
    assert mod.get(wc["id"]) is not None


def test_wildcard_delete_commits_and_returns_undo_id_plus_diff(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="x", description="", category_id=None,
                    tags=[], payload={"options": []})
    other = mod.create(type="wildcard", name="y", description="", category_id=None,
                       tags=[], payload={"options": []})
    c = mod.create(type="constraint", name="c1", description="", category_id=None,
                   tags=[], payload={"source_wildcard_id": wc["id"],
                                     "target_wildcard_id": other["id"],
                                     "matrix": {}, "exceptions": []})

    resp = apply_cascade(wp_db, {
        "kind": "wildcard", "id": wc["id"], "action": "delete",
    })

    assert resp["ok"] is True
    assert resp["undo_entry_id"]
    assert resp["affected_count"] >= 1
    assert resp["diff"]
    # Wildcard + constraint should be gone.
    with pytest.raises(ModuleNotFound):
        mod.get(wc["id"])
    with pytest.raises(ModuleNotFound):
        mod.get(c["id"])


def test_subcat_delete_does_not_delete_wildcard_target(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="x", description="", category_id=None, tags=[],
                    payload={"options": [{"id": "o", "value": "v", "weight": 1,
                                          "sub_categories": ["warm", "cool"]}]})

    resp = apply_cascade(wp_db, {
        "kind": "subcategory", "id": wc["id"], "action": "delete",
        "extra": {"subcat_name": "warm"},
    })

    assert resp["ok"] is True
    # Wildcard still exists — only the subcat was stripped.
    wc_after = mod.get(wc["id"])
    assert wc_after["payload"]["options"][0]["sub_categories"] == ["cool"]


def test_subcat_rename_with_cascade_false_returns_broken_refs(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="x", description="", category_id=None, tags=[],
                    payload={"options": [{"id": "o", "value": "v", "weight": 1,
                                          "sub_categories": ["warm"]}]})
    other = mod.create(type="wildcard", name="y", description="", category_id=None, tags=[],
                       payload={"options": []})
    c = mod.create(type="constraint", name="c1", description="", category_id=None, tags=[],
                   payload={"source_wildcard_id": wc["id"], "target_wildcard_id": other["id"],
                            "matrix": {"warm": {"a": {"mode": "block"}}}, "exceptions": []})

    resp = apply_cascade(wp_db, {
        "kind": "subcategory", "id": wc["id"], "action": "rename",
        "cascade_refs": False, "new_name": "hot",
        "extra": {"subcat_name": "warm"},
    })

    assert resp["ok"] is True
    assert resp["broken_refs"]
    assert any(b["id"] == c["id"] for b in resp["broken_refs"])
    # Constraint matrix still has old key (rename did NOT cascade).
    c_after = mod.get(c["id"])
    assert "warm" in c_after["payload"]["matrix"]
    # Wildcard's own subcat WAS renamed though.
    wc_after = mod.get(wc["id"])
    assert wc_after["payload"]["options"][0]["sub_categories"] == ["hot"]


def test_category_delete_removes_category_and_nulls_refs(wp_db):
    cat = CategoryRepository(wp_db).create(name="Style", color="#ff0000", icon="palette")
    mod = ModuleRepository(wp_db)
    m = mod.create(type="wildcard", name="w", description="", category_id=cat["id"], tags=[],
                   payload={"options": []})

    resp = apply_cascade(wp_db, {
        "kind": "category", "id": cat["id"], "action": "delete",
    })

    assert resp["ok"] is True
    # Module's category_id is now None.
    m_after = mod.get(m["id"])
    assert m_after["category_id"] is None
    # Category is deleted.
    from engine.db.repositories import CategoryNotFound
    with pytest.raises(CategoryNotFound):
        CategoryRepository(wp_db).get(cat["id"])


def test_missing_required_field_returns_error(wp_db):
    resp = apply_cascade(wp_db, {"kind": "wildcard", "action": "delete"})  # no id
    assert resp["ok"] is False
    assert "id" in resp["error"].lower() or "required" in resp["error"].lower()


def test_unsupported_kind_action_pair_returns_error(wp_db):
    resp = apply_cascade(wp_db, {
        "kind": "option_value", "id": "abc", "action": "delete",
        "extra": {"option_id": "o"},
    })
    assert resp["ok"] is False
    assert "unsupported" in resp["error"].lower()
