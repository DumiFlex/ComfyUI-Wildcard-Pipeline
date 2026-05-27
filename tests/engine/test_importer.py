"""Tests for `engine.importer` — atomic commit + snapshot-based undo.

Covers happy paths for every kind (5 module types + bundle + category),
the rollback path on PK collision, and undo restoration for adds,
replaces, and renames.
"""
from __future__ import annotations

from typing import Any

import pytest

from engine.db.repositories import (
    BundleNotFound,
    BundleRepository,
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
    TemplateNotFound,
    TemplateRepository,
)
from engine.importer import commit_import, get_undo_entry, undo_import

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _wildcard_entity(id_: str, name: str = "color") -> dict[str, Any]:
    return {
        "id": id_,
        "type": "wildcard",
        "name": name,
        "description": "",
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "payload": {"options": [{"id": "r", "value": "red", "weight": 1}]},
        "version": 1,
    }


def _fixed_values_entity(id_: str) -> dict[str, Any]:
    return {
        "id": id_, "type": "fixed_values", "name": "fv", "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "payload": {"values": [{"id": "v1", "name": "lens", "value": "wide"}]},
        "version": 1,
    }


def _combine_entity(id_: str) -> dict[str, Any]:
    return {
        "id": id_, "type": "combine", "name": "co", "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "payload": {"template": "$a", "output_var": "out"},
        "version": 1,
    }


def _derivation_entity(id_: str) -> dict[str, Any]:
    return {
        "id": id_, "type": "derivation", "name": "de", "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "payload": {
            "rules": [
                {"id": "r1", "branches": [{"key": "default", "actions": []}]},
            ],
        },
        "version": 1,
    }


def _constraint_entity(id_: str) -> dict[str, Any]:
    return {
        "id": id_, "type": "constraint", "name": "cn", "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "payload": {
            "source_wildcard_id": "s", "target_wildcard_id": "t",
            "matrix": {}, "exceptions": [],
        },
        "version": 1,
    }


def _bundle_entity(id_: str, name: str = "pack") -> dict[str, Any]:
    return {
        "id": id_, "name": name, "description": "",
        "color": None, "category_id": None, "tags": [],
        "is_favorite": False, "children": [], "version": 1,
    }


def _category_entity(id_: str, name: str) -> dict[str, Any]:
    return {
        "id": id_, "name": name, "color": None, "icon": None, "sort_order": 0,
    }


def _template_entity(id_: str, name: str = "tpl") -> dict[str, Any]:
    return {
        "id": id_, "name": name, "description": "",
        "category_id": None, "tags": [], "is_favorite": False,
        "template_string": "$subject, $style",
    }


# ---------------------------------------------------------------------------
# adds
# ---------------------------------------------------------------------------


def test_commit_inserts_adds(wp_db):
    """Smoke test: a single wildcard add ends up in the modules table at
    the supplied id and is fetchable via ModuleRepository."""
    payload = {
        "adds": [{"kind": "wildcard", "entity": _wildcard_entity("aabbccdd")}],
        "replaces": [],
        "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True
    assert "undo_id" in result
    row = ModuleRepository(wp_db).get("aabbccdd")
    assert row["type"] == "wildcard"
    assert row["name"] == "color"


def test_commit_handles_all_5_module_kinds(wp_db):
    """Verify the kind→table dispatch handles every one of the 5 module
    types in a single commit."""
    payload = {
        "adds": [
            {"kind": "wildcard",     "entity": _wildcard_entity("aaaaaaa1")},
            {"kind": "fixed_values", "entity": _fixed_values_entity("aaaaaaa2")},
            {"kind": "combine",      "entity": _combine_entity("aaaaaaa3")},
            {"kind": "derivation",   "entity": _derivation_entity("aaaaaaa4")},
            {"kind": "constraint",   "entity": _constraint_entity("aaaaaaa5")},
        ],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True

    repo = ModuleRepository(wp_db)
    for expected_type, mid in [
        ("wildcard",     "aaaaaaa1"),
        ("fixed_values", "aaaaaaa2"),
        ("combine",      "aaaaaaa3"),
        ("derivation",   "aaaaaaa4"),
        ("constraint",   "aaaaaaa5"),
    ]:
        assert repo.get(mid)["type"] == expected_type


def test_commit_handles_bundle_add(wp_db):
    payload = {
        "adds": [{"kind": "bundle", "entity": _bundle_entity("bbbbbbb1")}],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True
    assert BundleRepository(wp_db).get("bbbbbbb1")["name"] == "pack"


def test_commit_handles_template_add(wp_db):
    payload = {
        "adds": [{"kind": "template", "entity": _template_entity("ttttttt1")}],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True
    row = TemplateRepository(wp_db).get("ttttttt1")
    assert row["name"] == "tpl"
    assert row["template_string"] == "$subject, $style"


def test_commit_template_id_collision_on_add_returns_error(wp_db):
    """Adding a template at an id that already exists is a contract
    violation — the colliding id must surface in the message."""
    TemplateRepository(wp_db).create(name="seed")
    # Create at a known id by inserting a second template, then collide.
    existing = TemplateRepository(wp_db).create(name="taken")
    payload = {
        "adds": [{
            "kind": "template",
            "entity": _template_entity(existing["id"], name="dupe"),
        }],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is False
    assert "collision" in result["error"].lower()
    assert existing["id"] in result["error"]


def test_commit_handles_category_add_with_name_merge(wp_db):
    """Pre-seed a category named 'Style'. Add another category with the
    same name (different id) — the merge must skip the duplicate, the
    undo metadata must not record the skipped id, and the existing
    category must remain at its original slug id."""
    cat_repo = CategoryRepository(wp_db)
    existing = cat_repo.create(name="Style", color="#abcdef", icon="palette")
    assert existing["id"] == "style"

    payload = {
        "adds": [{
            "kind": "category",
            "entity": _category_entity("dupe-id", "Style"),
        }],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True

    # Still exactly one row, unchanged.
    rows = cat_repo.list()
    assert len(rows) == 1
    assert rows[0]["id"] == "style"
    assert rows[0]["color"] == "#abcdef"  # unmodified

    # Undo entry must NOT contain the skipped id — there's nothing
    # to undo.
    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    ids_imported = {rec["id"] for rec in undo["imported_records"]}
    assert "dupe-id" not in ids_imported
    assert "style" not in ids_imported


def test_commit_category_add_fresh_records_for_undo(wp_db):
    """A category that's truly new (no name collision) is recorded
    in imported_records so undo can delete it."""
    payload = {
        "adds": [{
            "kind": "category",
            "entity": _category_entity("fresh", "Fresh Category"),
        }],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True

    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    assert {"kind": "category", "id": "fresh"} in undo["imported_records"]


# ---------------------------------------------------------------------------
# replaces
# ---------------------------------------------------------------------------


def test_commit_snapshots_replaced(wp_db):
    """A pre-existing module that gets replaced must have its old row
    preserved verbatim in `replaced_snapshots` on the undo entry."""
    repo = ModuleRepository(wp_db)
    existing = repo.create(
        type="wildcard", name="old-name", description="old-desc",
        category_id=None, tags=["a"],
        payload={"options": [{"id": "x", "value": "old", "weight": 1}]},
        id="cafebabe",
    )

    new_content = _wildcard_entity("cafebabe", name="new-name")
    new_content["description"] = "new-desc"
    payload = {
        "adds": [],
        "replaces": [{
            "kind": "wildcard",
            "id": "cafebabe",
            "new_content": new_content,
        }],
        "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True

    # New content visible.
    after = repo.get("cafebabe")
    assert after["name"] == "new-name"
    assert after["description"] == "new-desc"

    # Old row captured in the undo snapshot.
    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    snap = undo["replaced_snapshots"]["cafebabe"]
    assert snap["kind"] == "wildcard"
    assert snap["row"]["name"] == "old-name"
    assert snap["row"]["description"] == "old-desc"
    assert snap["row"]["version"] == existing["version"]


def test_commit_replaces_template_and_snapshots(wp_db):
    """Replacing a template updates the row and stores the pre-replace
    snapshot (kind=='template') for undo."""
    repo = TemplateRepository(wp_db)
    existing = repo.create(
        name="old-tpl", description="old-desc",
        template_string="$a", tags=["x"],
    )
    tid = existing["id"]

    new_content = {
        "name": "new-tpl", "description": "new-desc",
        "category_id": None, "tags": ["y"], "is_favorite": True,
        "template_string": "$b",
    }
    result = commit_import(wp_db, {
        "adds": [],
        "replaces": [{"kind": "template", "id": tid, "new_content": new_content}],
        "renames": [],
    })
    assert result["ok"] is True

    after = repo.get(tid)
    assert after["name"] == "new-tpl"
    assert after["template_string"] == "$b"

    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    snap = undo["replaced_snapshots"][tid]
    assert snap["kind"] == "template"
    assert snap["row"]["name"] == "old-tpl"
    assert snap["row"]["template_string"] == "$a"


def test_commit_replace_missing_target_returns_error(wp_db):
    """Replacing a non-existent id is a contract violation — caller
    should have classified as add."""
    payload = {
        "adds": [],
        "replaces": [{
            "kind": "wildcard",
            "id": "deadbeef",
            "new_content": _wildcard_entity("deadbeef"),
        }],
        "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is False
    assert "not found" in result["error"].lower()


# ---------------------------------------------------------------------------
# renames
# ---------------------------------------------------------------------------


def test_commit_handles_rename(wp_db):
    """A rename ('Import as new') inserts at new_id and records the
    old→new mapping for the undo trail."""
    new_content = _wildcard_entity("bbbb2222")
    payload = {
        "adds": [], "replaces": [],
        "renames": [{
            "kind": "wildcard",
            "old_id": "aaaa1111",
            "new_id": "bbbb2222",
            "content": new_content,
        }],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is True

    # new_id resolves; old_id never existed in the DB.
    repo = ModuleRepository(wp_db)
    assert repo.get("bbbb2222")["name"] == "color"
    with pytest.raises(ModuleNotFound):
        repo.get("aaaa1111")

    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    assert undo["rename_map"]["aaaa1111"] == "bbbb2222"
    assert {"kind": "wildcard", "id": "bbbb2222"} in undo["imported_records"]


def test_commit_handles_template_rename(wp_db):
    """A template rename inserts at new_id and records old->new."""
    result = commit_import(wp_db, {
        "adds": [], "replaces": [],
        "renames": [{
            "kind": "template",
            "old_id": "tpold111",
            "new_id": "tpnew222",
            "content": _template_entity("tpnew222", name="renamed"),
        }],
    })
    assert result["ok"] is True

    repo = TemplateRepository(wp_db)
    assert repo.get("tpnew222")["name"] == "renamed"
    with pytest.raises(TemplateNotFound):
        repo.get("tpold111")

    undo = get_undo_entry(wp_db, result["undo_id"])
    assert undo is not None
    assert undo["rename_map"]["tpold111"] == "tpnew222"
    assert {"kind": "template", "id": "tpnew222"} in undo["imported_records"]


def test_commit_rename_collision_on_new_id_returns_error(wp_db):
    """Renaming to a new_id that already exists is a contract
    violation."""
    ModuleRepository(wp_db).create(
        type="wildcard", name="existing", description="",
        category_id=None, tags=[], payload={"options": []},
        id="bbbb2222",
    )
    payload = {
        "adds": [], "replaces": [],
        "renames": [{
            "kind": "wildcard",
            "old_id": "aaaa1111",
            "new_id": "bbbb2222",
            "content": _wildcard_entity("bbbb2222"),
        }],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is False
    assert "collision" in result["error"].lower()


# ---------------------------------------------------------------------------
# rollback
# ---------------------------------------------------------------------------


def test_commit_rolls_back_on_error(wp_db):
    """If an op partway through fails, every preceding write must roll
    back. No undo entry is persisted."""
    # Pre-seed a wildcard so the second add collides.
    ModuleRepository(wp_db).create(
        type="wildcard", name="seed", description="",
        category_id=None, tags=[], payload={"options": []},
        id="11111111",
    )

    payload = {
        "adds": [
            {"kind": "wildcard", "entity": _wildcard_entity("22222222")},
            {"kind": "wildcard", "entity": _wildcard_entity("11111111")},  # collision
        ],
        "replaces": [], "renames": [],
    }
    result = commit_import(wp_db, payload)
    assert result["ok"] is False

    # The first add must NOT have committed.
    with pytest.raises(ModuleNotFound):
        ModuleRepository(wp_db).get("22222222")

    # No undo entry was persisted.
    rows = wp_db.execute("SELECT COUNT(*) AS n FROM import_undo;").fetchone()
    assert rows["n"] == 0


def test_commit_returns_error_on_missing_required_field(wp_db):
    """A malformed add (id present, name absent) must return an error
    envelope rather than raising KeyError. The contract is 'never raise
    — return error envelope on contract violations.'"""
    payload = {
        "adds": [{"kind": "wildcard", "entity": {"id": "abcd1234"}}],
        "replaces": [], "renames": [],
    }
    # Should NOT raise — even though `entity["name"]` would KeyError on
    # bracket access in `_insert_module`, the pre-check turns it into a
    # clean error envelope.
    result = commit_import(wp_db, payload)
    assert result["ok"] is False
    assert "name" in result["error"].lower()

    # No undo entry created.
    rows = wp_db.execute("SELECT COUNT(*) AS n FROM import_undo;").fetchone()
    assert rows["n"] == 0


# ---------------------------------------------------------------------------
# undo
# ---------------------------------------------------------------------------


def test_undo_restores_replaced(wp_db):
    """After undo, a replaced module's content reverts to its pre-replace
    state and the undo entry is evicted."""
    repo = ModuleRepository(wp_db)
    repo.create(
        type="wildcard", name="orig", description="orig-desc",
        category_id=None, tags=["a", "b"],
        payload={"options": [{"id": "x", "value": "orig", "weight": 1}]},
        id="cafebabe",
    )

    new_content = _wildcard_entity("cafebabe", name="new")
    new_content["description"] = "new-desc"
    new_content["tags"] = ["z"]
    commit_result = commit_import(
        wp_db,
        {
            "adds": [],
            "replaces": [{
                "kind": "wildcard",
                "id": "cafebabe",
                "new_content": new_content,
            }],
            "renames": [],
        },
    )
    assert commit_result["ok"] is True
    undo_id = commit_result["undo_id"]

    # Sanity: row is overwritten.
    assert repo.get("cafebabe")["name"] == "new"

    undo_result = undo_import(wp_db, undo_id)
    assert undo_result["ok"] is True

    restored = repo.get("cafebabe")
    assert restored["name"] == "orig"
    assert restored["description"] == "orig-desc"
    assert restored["tags"] == ["a", "b"]

    # Undo entry removed.
    assert get_undo_entry(wp_db, undo_id) is None


def test_undo_deletes_added(wp_db):
    """Undo of a fresh add removes the row entirely."""
    commit_result = commit_import(
        wp_db,
        {
            "adds": [{
                "kind": "wildcard",
                "entity": _wildcard_entity("addaddad"),
            }],
            "replaces": [], "renames": [],
        },
    )
    assert commit_result["ok"] is True

    repo = ModuleRepository(wp_db)
    assert repo.get("addaddad")["name"] == "color"

    undo_import(wp_db, commit_result["undo_id"])

    with pytest.raises(ModuleNotFound):
        repo.get("addaddad")


def test_undo_deletes_added_bundle(wp_db):
    """Bundle add path: undo deletes the bundle row."""
    commit_result = commit_import(
        wp_db,
        {
            "adds": [{"kind": "bundle", "entity": _bundle_entity("bun11111")}],
            "replaces": [], "renames": [],
        },
    )
    assert commit_result["ok"] is True

    repo = BundleRepository(wp_db)
    assert repo.get("bun11111")["name"] == "pack"

    undo_import(wp_db, commit_result["undo_id"])

    with pytest.raises(BundleNotFound):
        repo.get("bun11111")


def test_undo_deletes_added_category(wp_db):
    """Category undo path: deletes the freshly-inserted category row."""
    commit_result = commit_import(
        wp_db,
        {
            "adds": [{
                "kind": "category",
                "entity": _category_entity("freshcat", "FreshCat"),
            }],
            "replaces": [], "renames": [],
        },
    )
    assert commit_result["ok"] is True
    assert any(c["id"] == "freshcat" for c in CategoryRepository(wp_db).list())

    undo_import(wp_db, commit_result["undo_id"])

    assert not any(
        c["id"] == "freshcat" for c in CategoryRepository(wp_db).list()
    )


def test_undo_deletes_added_template(wp_db):
    """Template add path: undo deletes the template row."""
    commit_result = commit_import(
        wp_db,
        {
            "adds": [{
                "kind": "template", "entity": _template_entity("tplundo1"),
            }],
            "replaces": [], "renames": [],
        },
    )
    assert commit_result["ok"] is True

    repo = TemplateRepository(wp_db)
    assert repo.get("tplundo1")["name"] == "tpl"

    undo_import(wp_db, commit_result["undo_id"])

    with pytest.raises(TemplateNotFound):
        repo.get("tplundo1")


def test_undo_restores_replaced_template(wp_db):
    """Template replace path: undo restores the prior content."""
    repo = TemplateRepository(wp_db)
    original = repo.create(
        name="orig-tpl", description="orig-desc",
        template_string="$a", tags=["a", "b"],
    )
    tid = original["id"]

    new_content = {
        "name": "new-tpl", "description": "new-desc",
        "category_id": None, "tags": ["z"], "is_favorite": True,
        "template_string": "$b",
    }
    commit_result = commit_import(wp_db, {
        "adds": [],
        "replaces": [{"kind": "template", "id": tid, "new_content": new_content}],
        "renames": [],
    })
    assert commit_result["ok"] is True
    assert repo.get(tid)["name"] == "new-tpl"

    undo_import(wp_db, commit_result["undo_id"])

    restored = repo.get(tid)
    assert restored["name"] == "orig-tpl"
    assert restored["description"] == "orig-desc"
    assert restored["template_string"] == "$a"
    assert restored["tags"] == ["a", "b"]
    assert restored["is_favorite"] is False


def test_undo_reverses_rename(wp_db):
    """Undo of a rename deletes the row inserted at new_id; old_id was
    never created in the first place, so the DB ends up empty."""
    commit_result = commit_import(
        wp_db,
        {
            "adds": [], "replaces": [],
            "renames": [{
                "kind": "wildcard",
                "old_id": "aaaa1111",
                "new_id": "bbbb2222",
                "content": _wildcard_entity("bbbb2222"),
            }],
        },
    )
    assert commit_result["ok"] is True
    repo = ModuleRepository(wp_db)
    assert repo.get("bbbb2222")["name"] == "color"

    undo_import(wp_db, commit_result["undo_id"])

    with pytest.raises(ModuleNotFound):
        repo.get("bbbb2222")
    with pytest.raises(ModuleNotFound):
        repo.get("aaaa1111")


def test_undo_handles_missing_entry(wp_db):
    """Calling undo with a nonexistent undo_id returns an error envelope
    rather than raising."""
    result = undo_import(wp_db, "ffffffffffffffff")
    assert result["ok"] is False
    assert "not found" in result["error"].lower()


# ---------------------------------------------------------------------------
# bundle replace + undo
# ---------------------------------------------------------------------------


def test_undo_restores_replaced_bundle(wp_db):
    """Bundle replace path: undo restores the bundle's previous content
    bit-for-bit (children, version, payload_hash)."""
    repo = BundleRepository(wp_db)
    original = repo.create(
        name="orig-bundle", description="orig-desc",
        children=[{"id": "x", "type": "wildcard", "name": "x"}],
        id="aaa99999",
    )

    new_content = _bundle_entity("aaa99999", name="new-bundle")
    new_content["description"] = "new-desc"
    new_content["children"] = [
        {"id": "y", "type": "wildcard", "name": "y"},
    ]
    commit_result = commit_import(
        wp_db,
        {
            "adds": [],
            "replaces": [{
                "kind": "bundle",
                "id": "aaa99999",
                "new_content": new_content,
            }],
            "renames": [],
        },
    )
    assert commit_result["ok"] is True
    assert repo.get("aaa99999")["name"] == "new-bundle"

    undo_import(wp_db, commit_result["undo_id"])

    restored = repo.get("aaa99999")
    assert restored["name"] == "orig-bundle"
    assert restored["description"] == "orig-desc"
    assert restored["children"] == original["children"]
    assert restored["version"] == original["version"]
    assert restored["payload_hash"] == original["payload_hash"]
