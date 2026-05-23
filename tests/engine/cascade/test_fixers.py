"""Tests for per-mutation cleanup fixers in engine/cascade/fixers.py."""

from engine.cascade.fixers import (
    fix_category_delete,
    fix_combine_output_var_rename,
    fix_subcat_delete,
    fix_subcat_rename,
    fix_wildcard_delete,
)
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleRepository,
)


def test_fix_wildcard_delete_strips_constraints_and_bundle_refs(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="x", description="", category_id=None, tags=[],
                    payload={"options": []})
    other = mod.create(type="wildcard", name="y", description="", category_id=None, tags=[],
                       payload={"options": []})
    c = mod.create(type="constraint", name="c1", description="", category_id=None, tags=[],
                   payload={"source_wildcard_id": wc["id"], "target_wildcard_id": other["id"],
                            "matrix": {}, "exceptions": []})
    b = BundleRepository(wp_db).create(name="b1",
                                        children=[{"id": wc["id"], "type": "module"},
                                                  {"id": other["id"], "type": "module"}])

    touched, diff = fix_wildcard_delete(wp_db, wc["id"])

    # Constraint referencing wc must be deleted.
    try:
        mod.get(c["id"])
        raise AssertionError("constraint should be deleted")
    except Exception:
        pass
    # Bundle should now have only `other` as a child.
    bundle_after = BundleRepository(wp_db).get(b["id"])
    assert {ch["id"] for ch in bundle_after["children"]} == {other["id"]}
    # Touched + diff non-empty.
    assert any(t["id"] == c["id"] for t in touched)
    assert any(t["id"] == b["id"] for t in touched)
    assert len(diff) >= 2


def test_fix_subcat_delete_strips_matrix_keys_and_source_subcats(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard",
        name="x",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o",
            "value": "v",
            "weight": 1,
            "sub_categories": ["warm", "cool"],
        }]},
    )
    other = mod.create(
        type="wildcard",
        name="y",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o2",
            "value": "v",
            "weight": 1,
            "sub_categories": ["a"],
        }]},
    )
    c = mod.create(
        type="constraint",
        name="c1",
        description="",
        category_id=None,
        tags=[],
        payload={
            "source_wildcard_id": wc["id"],
            "target_wildcard_id": other["id"],
            "matrix": {
                "warm": {"a": {"mode": "block"}},
                "cool": {"a": {"mode": "allow"}},
            },
            "exceptions": [],
        },
    )

    touched, diff = fix_subcat_delete(wp_db, wc["id"], "warm")

    c_after = mod.get(c["id"])
    assert "warm" not in c_after["payload"]["matrix"]
    assert "cool" in c_after["payload"]["matrix"]
    wc_after = mod.get(wc["id"])
    assert wc_after["payload"]["options"][0]["sub_categories"] == ["cool"]


def test_fix_subcat_delete_strips_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    target = mod.create(
        type="wildcard",
        name="palette",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o1",
            "value": "red",
            "weight": 1,
            "sub_categories": ["warm"],
        }]},
    )
    referrer = mod.create(
        type="wildcard",
        name="user",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "u1",
            "value": "see @{" + target["id"] + ":warm} now",
            "weight": 1,
        }]},
    )

    touched, diff = fix_subcat_delete(wp_db, target["id"], "warm")

    ref_after = mod.get(referrer["id"])
    assert ":warm}" not in ref_after["payload"]["options"][0]["value"]


def test_fix_subcat_rename_rewrites_matrix_keys_and_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard",
        name="x",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o",
            "value": "v",
            "weight": 1,
            "sub_categories": ["warm"],
        }]},
    )
    referrer = mod.create(
        type="wildcard",
        name="r",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o2",
            "value": "see @{" + wc["id"] + ":warm} now",
            "weight": 1,
        }]},
    )
    other = mod.create(type="wildcard", name="y", description="", category_id=None, tags=[],
                       payload={"options": []})
    c = mod.create(type="constraint", name="c1", description="", category_id=None, tags=[],
                   payload={"source_wildcard_id": wc["id"], "target_wildcard_id": other["id"],
                            "matrix": {"warm": {"a": {"mode": "block"}}}, "exceptions": []})

    touched, diff = fix_subcat_rename(wp_db, wc["id"], "warm", "hot")

    wc_after = mod.get(wc["id"])
    assert wc_after["payload"]["options"][0]["sub_categories"] == ["hot"]
    referrer_after = mod.get(referrer["id"])
    assert ":hot}" in referrer_after["payload"]["options"][0]["value"]
    assert ":warm}" not in referrer_after["payload"]["options"][0]["value"]
    c_after = mod.get(c["id"])
    assert "warm" not in c_after["payload"]["matrix"]
    assert "hot" in c_after["payload"]["matrix"]


def test_fix_combine_output_var_rename_rewrites_var_refs(wp_db):
    mod = ModuleRepository(wp_db)
    cb = mod.create(
        type="combine",
        name="cb",
        description="",
        category_id=None,
        tags=[],
        payload={"template": "$a", "output_var": "mood"},
    )
    wc = mod.create(
        type="wildcard",
        name="w",
        description="",
        category_id=None,
        tags=[],
        payload={"options": [{
            "id": "o",
            "value": "uses $mood here",
            "weight": 1,
        }]},
    )
    deriv = mod.create(
        type="derivation",
        name="d",
        description="",
        category_id=None,
        tags=[],
        payload={"rules": [{
            "id": "r1",
            "branches": [{
                "key": "default",
                "actions": [{
                    "set_var": "mood",
                    "value": "x",
                }],
            }],
        }]},
    )

    touched, diff = fix_combine_output_var_rename(wp_db, cb["id"], "mood", "tone")

    cb_after = mod.get(cb["id"])
    assert cb_after["payload"]["output_var"] == "tone"
    wc_after = mod.get(wc["id"])
    assert "$tone" in wc_after["payload"]["options"][0]["value"]
    assert "$mood" not in wc_after["payload"]["options"][0]["value"]
    deriv_after = mod.get(deriv["id"])
    assert deriv_after["payload"]["rules"][0]["branches"][0]["actions"][0]["set_var"] == "tone"


def test_fix_category_delete_nulls_category_id(wp_db):
    cat = CategoryRepository(wp_db).create(name="Style", color="#f00", icon="palette")
    mod = ModuleRepository(wp_db)
    m1 = mod.create(type="wildcard", name="w1", description="", category_id=cat["id"], tags=[],
                    payload={"options": []})

    touched, diff = fix_category_delete(wp_db, cat["id"])

    m1_after = mod.get(m1["id"])
    assert m1_after["category_id"] is None
    assert any(t["id"] == m1["id"] for t in touched)
