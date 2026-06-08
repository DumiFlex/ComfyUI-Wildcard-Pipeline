"""QA edge cases for sub-category cascade rename/delete (SP1 Chunk E).

Complements tests/test_fix_subcat_cascade.py (which covers the basic
rewrite / collapse / bare-ref / name+null cases) with the trickier
boolean-expression shapes the operator-collapse path has to survive:
`not`, nested parens, multi-term OR with a middle delete, `!null`
preservation through a collapse, and a single rename that has to land
across every surface at once (registry + option membership + constraint
matrix key + a nested ref expr in another wildcard)."""
from engine.cascade.fixers import fix_subcat_delete, fix_subcat_rename
from engine.db.repositories import ModuleRepository


def _wildcard(mod, name, payload):
    return mod.create(
        type="wildcard", name=name, description="", category_id=None, tags=[],
        payload=payload,
    )


def _ref_value(mod, target_id, expr):
    return _wildcard(mod, "referrer", {"options": [
        {"id": "u1", "value": f"x @{{{target_id}:{expr}}} y", "weight": 1},
    ]})


def _ref_expr_after(mod, referrer_id):
    """The rewritten ref expression (between ':' and '}'), or '' when the
    filter collapsed away."""
    val = mod.get(referrer_id)["payload"]["options"][0]["value"]
    import re
    m = re.search(r"@\{[0-9a-f]+(?::([^}!]*))?(?:!([^}]*))?\}", val)
    return (m.group(1) or "") if m else "<no-ref>"


# ── operator-collapse shapes on delete ───────────────────────────────────

def test_delete_collapses_and_not(wp_db):
    """`warm and not cold` − cold → `warm` (the AND and the NOT both
    collapse once their only other operand is gone)."""
    mod = ModuleRepository(wp_db)
    t = _wildcard(mod, "palette", {"sub_categories": ["warm", "cold"], "options": []})
    r = _ref_value(mod, t["id"], "warm and not cold")
    fix_subcat_delete(wp_db, t["id"], "cold")
    assert _ref_expr_after(mod, r["id"]) == "warm"


def test_delete_middle_of_three_term_or(wp_db):
    """`warm or cold or hot` − cold → `warm or hot` (no dangling OR)."""
    mod = ModuleRepository(wp_db)
    t = _wildcard(mod, "palette", {"sub_categories": ["warm", "cold", "hot"], "options": []})
    r = _ref_value(mod, t["id"], "warm or cold or hot")
    fix_subcat_delete(wp_db, t["id"], "cold")
    assert _ref_expr_after(mod, r["id"]) == "warm or hot"


def test_delete_inside_parens_keeps_other_group(wp_db):
    """`(warm or cold) and bright` − cold → `warm and bright`."""
    mod = ModuleRepository(wp_db)
    t = _wildcard(mod, "palette", {"sub_categories": ["warm", "cold", "bright"], "options": []})
    r = _ref_value(mod, t["id"], "(warm or cold) and bright")
    fix_subcat_delete(wp_db, t["id"], "cold")
    assert _ref_expr_after(mod, r["id"]) == "warm and bright"


def test_delete_preserves_null_marker_on_collapse(wp_db):
    """`warm or cold!null` − cold → `warm!null` (filter shrinks, the
    exclude-null marker rides along)."""
    mod = ModuleRepository(wp_db)
    t = _wildcard(mod, "palette", {"sub_categories": ["warm", "cold"], "options": []})
    r = _wildcard(mod, "referrer", {"options": [
        {"id": "u1", "value": f"@{{{t['id']}:warm or cold!null}}", "weight": 1},
    ]})
    fix_subcat_delete(wp_db, t["id"], "cold")
    assert f"@{{{t['id']}:warm!null}}" in mod.get(r["id"])["payload"]["options"][0]["value"]


def test_delete_only_tag_keeps_bare_ref_with_null(wp_db):
    """`cold!null` − cold → bare `@{uuid!null}` — the insertion + the
    null marker survive, only the now-empty tag filter is dropped."""
    mod = ModuleRepository(wp_db)
    t = _wildcard(mod, "palette", {"sub_categories": ["cold"], "options": []})
    r = _wildcard(mod, "referrer", {"options": [
        {"id": "u1", "value": f"@{{{t['id']}:cold!null}}", "weight": 1},
    ]})
    fix_subcat_delete(wp_db, t["id"], "cold")
    assert f"@{{{t['id']}!null}}" in mod.get(r["id"])["payload"]["options"][0]["value"]


# ── a ref to a DIFFERENT wildcard must be untouched ──────────────────────

def test_rename_leaves_other_wildcards_refs_alone(wp_db):
    """A `cold` term inside a ref to a *different* wildcard is a different
    namespace — renaming palette:cold must not touch it."""
    mod = ModuleRepository(wp_db)
    palette = _wildcard(mod, "palette", {"sub_categories": ["cold"], "options": []})
    other = _wildcard(mod, "other", {"sub_categories": ["cold"], "options": []})
    r = _wildcard(mod, "referrer", {"options": [{
        "id": "u1",
        "value": f"@{{{palette['id']}:cold}} @{{{other['id']}:cold}}",
        "weight": 1,
    }]})
    fix_subcat_rename(wp_db, palette["id"], "cold", "chilly")
    val = mod.get(r["id"])["payload"]["options"][0]["value"]
    assert f"@{{{palette['id']}:chilly}}" in val   # renamed
    assert f"@{{{other['id']}:cold}}" in val        # untouched


# ── one rename, every surface at once ────────────────────────────────────

def test_rename_hits_registry_options_constraint_and_ref(wp_db):
    mod = ModuleRepository(wp_db)
    palette = _wildcard(mod, "palette", {
        "sub_categories": ["warm", "cold"],
        "options": [
            {"id": "o1", "value": "ember", "weight": 1, "sub_categories": ["warm"]},
            {"id": "o2", "value": "ice", "weight": 1, "sub_categories": ["cold"]},
        ],
    })
    # Constraint: palette is the source — matrix top-level keys are its subcats.
    con = mod.create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": palette["id"],
            "target_wildcard_id": "ffffffff",
            "matrix": {"warm": {"x": "allow"}, "cold": {"x": "deny"}},
        },
    )
    ref = _ref_value(mod, palette["id"], "warm or cold")

    fix_subcat_rename(wp_db, palette["id"], "cold", "chilly")

    pp = mod.get(palette["id"])["payload"]
    assert pp["sub_categories"] == ["warm", "chilly"]
    assert pp["options"][1]["sub_categories"] == ["chilly"]
    cm = mod.get(con["id"])["payload"]["matrix"]
    assert "chilly" in cm and "cold" not in cm
    assert _ref_expr_after(mod, ref["id"]) == "warm or chilly"


def test_delete_hits_registry_options_constraint_and_ref(wp_db):
    mod = ModuleRepository(wp_db)
    palette = _wildcard(mod, "palette", {
        "sub_categories": ["warm", "cold"],
        "options": [
            {"id": "o1", "value": "ember", "weight": 1, "sub_categories": ["warm", "cold"]},
        ],
    })
    # Constraint: palette is the target — its subcats are nested matrix keys.
    con = mod.create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": "ffffffff",
            "target_wildcard_id": palette["id"],
            "matrix": {"srcTag": {"warm": "allow", "cold": "deny"}},
        },
    )
    ref = _ref_value(mod, palette["id"], "warm or cold")

    fix_subcat_delete(wp_db, palette["id"], "cold")

    pp = mod.get(palette["id"])["payload"]
    assert pp["sub_categories"] == ["warm"]
    assert pp["options"][0]["sub_categories"] == ["warm"]
    cm = mod.get(con["id"])["payload"]["matrix"]
    assert cm["srcTag"] == {"warm": "allow"}
    assert _ref_expr_after(mod, ref["id"]) == "warm"
