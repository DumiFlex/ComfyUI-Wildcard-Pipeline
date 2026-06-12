"""Tests for per-mutation cleanup fixers in engine/cascade/fixers.py."""

import pytest

from engine.cascade.fixers import (
    _rewrite_var_in_string,
    fix_category_delete,
    fix_combine_output_var_rename,
    fix_subcat_delete,
    fix_subcat_rename,
    fix_wildcard_delete,
    fix_wildcard_rename_name,
)
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
)


def test_rewrite_var_preserves_list_accessor():
    """SP2a: renaming a var must keep a `.K` list accessor intact —
    `$mood.0` -> `$vibe.0`. The word-boundary lookahead stops at the dot, so
    the base renames and the accessor survives. A longer name that merely
    starts with the renamed token is left alone."""
    assert _rewrite_var_in_string("$mood.0 and $mood", "mood", "vibe") == "$vibe.0 and $vibe"
    assert _rewrite_var_in_string("$mood.12 x", "mood", "vibe") == "$vibe.12 x"
    assert _rewrite_var_in_string("$moodier", "mood", "vibe") == "$moodier"


def test_fix_wildcard_delete_strips_constraints_but_preserves_bundle_snapshots(wp_db):
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

    # Constraint referencing wc must be deleted (id-only ref, no fallback).
    with pytest.raises(ModuleNotFound):
        mod.get(c["id"])
    # Bundle children are frozen snapshots — wc's entry stays intact
    # even though the source library row is gone. The bundle keeps
    # resolving with the captured payload.
    bundle_after = BundleRepository(wp_db).get(b["id"])
    assert {ch["id"] for ch in bundle_after["children"]} == {wc["id"], other["id"]}
    # Only the constraint shows up in touched + diff; bundle untouched.
    assert any(t["id"] == c["id"] for t in touched)
    assert not any(t["id"] == b["id"] for t in touched)
    assert any(
        d.get("entity_id") == c["id"] and d.get("removed") is True for d in diff
    )
    assert not any(d.get("entity_id") == b["id"] for d in diff)


def test_fix_wildcard_rename_name_leaves_bundle_snapshots_frozen(wp_db):
    """A wildcard rename rewrites `@{uuid#name}` cached labels in LIVE
    library modules, but a bundle is a frozen point-in-time snapshot: its
    children (cached name + embedded refs) must NOT be auto-rewritten —
    only the explicit "refresh drifted + update bundle" flow re-snapshots.
    Mirrors fix_wildcard_delete's deliberate bundle-preservation stance."""
    mod = ModuleRepository(wp_db)
    wc = mod.create(type="wildcard", name="oldname", description="", category_id=None, tags=[],
                    payload={"options": []})
    ref = "@{" + wc["id"] + "#oldname}"
    live = mod.create(type="wildcard", name="live", description="", category_id=None, tags=[],
                      payload={"options": [{"id": "o1", "value": "see " + ref}]})
    b = BundleRepository(wp_db).create(name="b1", children=[
        {"id": wc["id"], "type": "wildcard", "name": "oldname", "payload": {"options": []}},
        {"id": live["id"], "type": "wildcard",
         "payload": {"options": [{"id": "o1", "value": "see " + ref}]}},
    ])

    touched, diff = fix_wildcard_rename_name(wp_db, wc["id"], "newname")

    # LIVE module ref IS rewritten — library content tracks the rename.
    live_after = mod.get(live["id"])
    assert live_after["payload"]["options"][0]["value"] == "see @{" + wc["id"] + "#newname}"

    # BUNDLE child snapshots stay FROZEN — cached name + embedded ref both
    # untouched, and the bundle never appears in touched/diff.
    bundle_after = BundleRepository(wp_db).get(b["id"])
    ch = {child["id"]: child for child in bundle_after["children"]}
    assert ch[wc["id"]]["name"] == "oldname"
    assert ch[live["id"]]["payload"]["options"][0]["value"] == "see " + ref
    assert not any(t["id"] == b["id"] for t in touched)
    assert not any(d.get("entity_id") == b["id"] for d in diff)


def test_fix_subcat_delete_strips_matrix_keys_and_source_subcats(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard",
        name="x",
        description="",
        category_id=None,
        tags=[],
        payload={
            "sub_categories": ["warm", "cool"],
            "options": [{
                "id": "o",
                "value": "v",
                "weight": 1,
                "sub_categories": ["warm"],
            }],
        },
    )
    other = mod.create(
        type="wildcard",
        name="y",
        description="",
        category_id=None,
        tags=[],
        payload={
            "sub_categories": ["a"],
            "options": [{
                "id": "o2",
                "value": "v",
                "weight": 1,
                "sub_categories": ["a"],
            }],
        },
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
    assert wc_after["payload"]["sub_categories"] == ["cool"]
    assert wc_after["payload"]["options"][0]["sub_categories"] == []
    # Verify diff shape: constraint + wildcard mutations
    assert any(
        d.get("entity_id") == c["id"]
        and d.get("remove_ref", {}).get("kind") == "subcat"
        for d in diff
    )
    assert any(
        d.get("entity_id") == wc["id"]
        and d.get("remove_ref", {}).get("kind") == "subcat"
        for d in diff
    )


def test_fix_subcat_delete_strips_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    target = mod.create(
        type="wildcard",
        name="palette",
        description="",
        category_id=None,
        tags=[],
        payload={
            "sub_categories": ["warm"],
            "options": [{
                "id": "o1",
                "value": "red",
                "weight": 1,
                "sub_categories": ["warm"],
            }],
        },
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
    # Verify diff shape: target wildcard + referrer wildcard
    assert any(
        d.get("entity_id") == target["id"]
        and d.get("remove_ref", {}).get("kind") == "subcat"
        for d in diff
    )
    assert any(
        d.get("entity_id") == referrer["id"]
        and d.get("remove_ref", {}).get("kind") == "subcat"
        for d in diff
    )


def test_fix_subcat_rename_rewrites_matrix_keys_and_text_refs(wp_db):
    mod = ModuleRepository(wp_db)
    wc = mod.create(
        type="wildcard",
        name="x",
        description="",
        category_id=None,
        tags=[],
        payload={
            "sub_categories": ["warm"],
            "options": [{
                "id": "o",
                "value": "v",
                "weight": 1,
                "sub_categories": ["warm"],
            }],
        },
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
    assert wc_after["payload"]["sub_categories"] == ["hot"]
    assert wc_after["payload"]["options"][0]["sub_categories"] == ["hot"]
    referrer_after = mod.get(referrer["id"])
    assert ":hot}" in referrer_after["payload"]["options"][0]["value"]
    assert ":warm}" not in referrer_after["payload"]["options"][0]["value"]
    c_after = mod.get(c["id"])
    assert "warm" not in c_after["payload"]["matrix"]
    assert "hot" in c_after["payload"]["matrix"]
    # Verify diff shape: source wildcard + referrer + constraint mutations
    assert any(
        d.get("entity_id") == wc["id"]
        and d.get("rename_ref", {}).get("kind") == "subcat"
        for d in diff
    )
    assert any(
        d.get("entity_id") == referrer["id"]
        and d.get("rename_ref", {}).get("kind") == "subcat"
        for d in diff
    )
    assert any(
        d.get("entity_id") == c["id"]
        and d.get("rename_ref", {}).get("kind") == "subcat"
        for d in diff
    )


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
    # Verify diff shape: combine + wildcard + derivation mutations
    assert any(
        d.get("entity_id") == cb["id"]
        and d.get("rename_ref", {}).get("kind") == "var"
        for d in diff
    )
    assert any(
        d.get("entity_id") == wc["id"]
        and d.get("rename_ref", {}).get("kind") == "var"
        for d in diff
    )
    assert any(
        d.get("entity_id") == deriv["id"]
        and d.get("rename_ref", {}).get("kind") == "var"
        for d in diff
    )


def test_fix_category_delete_nulls_category_id(wp_db):
    cat = CategoryRepository(wp_db).create(name="Style", color="#f00", icon="palette")
    mod = ModuleRepository(wp_db)
    m1 = mod.create(type="wildcard", name="w1", description="", category_id=cat["id"], tags=[],
                    payload={"options": []})

    touched, diff = fix_category_delete(wp_db, cat["id"])

    m1_after = mod.get(m1["id"])
    assert m1_after["category_id"] is None
    assert any(t["id"] == m1["id"] for t in touched)
    # Verify diff shape: module category removal
    assert any(
        d.get("entity_id") == m1["id"]
        and d.get("remove_ref", {}).get("kind") == "category"
        for d in diff
    )
