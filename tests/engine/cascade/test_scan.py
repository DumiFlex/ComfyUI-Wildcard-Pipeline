"""Reverse-ref scan tests for cascade-edit mutations."""
from engine.cascade.scan import scan_affected
from engine.db.repositories import BundleRepository, CategoryRepository, ModuleRepository


def test_scan_wildcard_delete_returns_bundles_and_constraints_and_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard", name="palette", description="", category_id=None, tags=[],
        payload={"options": [{"id": "o1", "value": "red", "weight": 1}]},
    )
    other_wc = mod.create(
        type="wildcard", name="other", description="", category_id=None, tags=[],
        payload={"options": [{"id": "o2", "value": "see @{" + wc["id"] + "}", "weight": 1}]},
    )
    constraint = mod.create(
        type="constraint", name="c1", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": wc["id"],
            "target_wildcard_id": other_wc["id"],
            "matrix": {},
            "exceptions": [],
        },
    )
    bundle = BundleRepository(wp_db).create(
        name="b1",
        children=[{"id": wc["id"], "type": "module"}],
    )

    affected = scan_affected(wp_db, kind="wildcard", id=wc["id"], action="delete")

    affected_ids = {a["id"] for a in affected}
    assert constraint["id"] in affected_ids
    assert other_wc["id"] in affected_ids
    # Bundles intentionally NOT in the impact set — children are frozen
    # snapshots independent of the source wildcard, so a delete leaves
    # them untouched. See engine/cascade/fixers.py:fix_wildcard_delete.
    assert bundle["id"] not in affected_ids


def test_scan_subcat_delete_returns_constraint_with_matrix_key(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard", name="palette", description="", category_id=None, tags=[],
        payload={"options": [
            {"id": "o1", "value": "red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "o2", "value": "blue", "weight": 1, "sub_categories": ["cool"]},
        ]},
    )
    other = mod.create(
        type="wildcard", name="other", description="", category_id=None, tags=[],
        payload={"options": [{"id": "x", "value": "x", "weight": 1, "sub_categories": ["a"]}]},
    )
    c1 = mod.create(
        type="constraint", name="c1", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": wc["id"],
            "target_wildcard_id": other["id"],
            "matrix": {"warm": {"a": {"mode": "block"}}},
            "exceptions": [],
        },
    )

    affected = scan_affected(
        wp_db, kind="subcategory", id=wc["id"], action="delete",
        extra={"subcat_name": "warm"},
    )

    assert {a["id"] for a in affected} == {c1["id"]}


def test_scan_subcat_delete_also_catches_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    target = mod.create(
        type="wildcard", name="palette", description="", category_id=None, tags=[],
        payload={"options": [
            {"id": "o1", "value": "red", "weight": 1, "sub_categories": ["warm"]},
        ]},
    )
    referrer = mod.create(
        type="wildcard", name="user", description="", category_id=None, tags=[],
        payload={"options": [
            {"id": "u1", "value": "see @{" + target["id"] + ":warm} now", "weight": 1},
        ]},
    )

    affected = scan_affected(
        wp_db, kind="subcategory", id=target["id"], action="delete",
        extra={"subcat_name": "warm"},
    )

    assert referrer["id"] in {a["id"] for a in affected}


def test_scan_combine_output_var_rename_returns_derivations_and_wildcards(wp_db):
    mod = ModuleRepository(wp_db)
    combine = mod.create(
        type="combine", name="c1", description="", category_id=None, tags=[],
        payload={"template": "$a", "output_var": "mood"},
    )
    deriv = mod.create(
        type="derivation", name="d1", description="", category_id=None, tags=[],
        payload={"rules": [{"id": "r1", "branches": [{"key": "default", "actions": [
            {"set_var": "mood", "value": "x"},
        ]}]}]},
    )
    wildcard = mod.create(
        type="wildcard", name="w1", description="", category_id=None, tags=[],
        payload={"options": [{"id": "o1", "value": "uses $mood here", "weight": 1}]},
    )

    affected = scan_affected(
        wp_db, kind="combine_output_var", id=combine["id"], action="rename",
        extra={"old_name": "mood", "new_name": "tone"},
    )

    affected_ids = {a["id"] for a in affected}
    assert deriv["id"] in affected_ids
    assert wildcard["id"] in affected_ids


def test_scan_category_delete_returns_modules_with_that_category_id(wp_db):
    cat = CategoryRepository(wp_db).create(name="Style", color="#ff0000", icon="palette")
    mod = ModuleRepository(wp_db)
    m1 = mod.create(
        type="wildcard", name="w1", description="", category_id=cat["id"], tags=[],
        payload={"options": []},
    )
    m2 = mod.create(
        type="combine", name="c1", description="", category_id=cat["id"], tags=[],
        payload={"template": "$a", "output_var": "x"},
    )

    affected = scan_affected(wp_db, kind="category", id=cat["id"], action="delete")

    assert {a["id"] for a in affected} == {m1["id"], m2["id"]}


def test_scan_returns_empty_when_no_refs(wp_db):
    mod = ModuleRepository(wp_db)
    isolated = mod.create(
        type="wildcard", name="iso", description="", category_id=None, tags=[],
        payload={"options": []},
    )

    affected = scan_affected(wp_db, kind="wildcard", id=isolated["id"], action="delete")

    assert affected == []


def test_scan_returns_empty_for_unsupported_kind_action_pair(wp_db):
    """v1 stub: unrecognized (kind, action) pairs return empty list."""
    mod = ModuleRepository(wp_db)
    m = mod.create(
        type="wildcard", name="x", description="", category_id=None, tags=[],
        payload={"options": []},
    )

    # Not yet implemented for v1.
    affected = scan_affected(
        wp_db, kind="option_value", id=m["id"], action="delete",
        extra={"option_id": "o1"},
    )

    assert affected == []
