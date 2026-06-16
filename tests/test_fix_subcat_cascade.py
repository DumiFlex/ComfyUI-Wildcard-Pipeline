"""Cascade rename/delete rewrites the subcat token INSIDE boolean
expressions in nested @{} ref values (not just bare-subcat refs)."""
from engine.cascade.fixers import fix_subcat_delete, fix_subcat_rename
from engine.db.repositories import ModuleRepository


def _wildcard(mod, name, payload):
    return mod.create(
        type="wildcard", name=name, description="", category_id=None, tags=[],
        payload=payload,
    )


def _ref_value(mod, target_id, expr):
    """A referrer wildcard whose only option value embeds @{target:expr}."""
    return _wildcard(mod, "referrer", {"options": [
        {"id": "u1", "value": f"see @{{{target_id}:{expr}}} now", "weight": 1},
    ]})


def test_rename_rewrites_boolean_expr(wp_db):
    mod = ModuleRepository(wp_db)
    target = _wildcard(mod, "palette", {
        "sub_categories": ["warm", "cold"], "options": [],
    })
    referrer = _ref_value(mod, target["id"], "warm or cold")

    fix_subcat_rename(wp_db, target["id"], "cold", "chilly")

    val = mod.get(referrer["id"])["payload"]["options"][0]["value"]
    assert f"@{{{target['id']}:warm or chilly}}" in val


def test_delete_collapses_boolean_expr(wp_db):
    mod = ModuleRepository(wp_db)
    target = _wildcard(mod, "palette", {
        "sub_categories": ["warm", "cold"], "options": [],
    })
    referrer = _ref_value(mod, target["id"], "warm or cold")

    fix_subcat_delete(wp_db, target["id"], "cold")

    val = mod.get(referrer["id"])["payload"]["options"][0]["value"]
    assert f"@{{{target['id']}:warm}}" in val
    assert "cold" not in val


def test_delete_only_tag_collapses_to_bare_ref(wp_db):
    mod = ModuleRepository(wp_db)
    target = _wildcard(mod, "palette", {"sub_categories": ["cold"], "options": []})
    referrer = _ref_value(mod, target["id"], "cold")

    fix_subcat_delete(wp_db, target["id"], "cold")

    val = mod.get(referrer["id"])["payload"]["options"][0]["value"]
    # Nested insertion survives; only its (now-empty) filter is dropped.
    assert f"see @{{{target['id']}}} now" == val


def test_rename_preserves_name_and_null_marker(wp_db):
    mod = ModuleRepository(wp_db)
    target = _wildcard(mod, "palette", {
        "sub_categories": ["warm", "cold"], "options": [],
    })
    referrer = _wildcard(mod, "referrer", {"options": [
        {"id": "u1", "value": f"@{{{target['id']}#palette:warm or cold!null}}", "weight": 1},
    ]})

    fix_subcat_rename(wp_db, target["id"], "cold", "chilly")

    val = mod.get(referrer["id"])["payload"]["options"][0]["value"]
    assert f"@{{{target['id']}#palette:warm or chilly!null}}" in val
