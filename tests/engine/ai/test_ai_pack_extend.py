"""Extend with AI: planning into an existing bundle and installing into it."""
from __future__ import annotations

import pytest

from engine.ai import pack


def _wild(mid, name, var, tags=()):
    return {"id": mid, "type": "wildcard", "name": name, "description": "",
            "payload": {"var_binding": var, "sub_categories": list(tags), "options": [
                {"id": f"{mid[:4]}000{n}", "value": f"{var} {n}", "weight": 1,
                 "sub_categories": list(tags[:1])} for n in range(2)]}}


def _child(row):
    return {"id": row["id"], "type": row["type"], "enabled": True, "meta": {"name": row["name"]},
            "payload": row["payload"], "instance": {}}


LIB = [_wild("aaaa0001", "Class", "class", ("magic",)), _wild("bbbb0001", "Weapon", "weapon",
                                                               ("blade",))]
DERIV = {"id": "cccc0001", "type": "derivation", "meta": {"name": "Title"},
         "payload": {"rules": [{"branches": [], "else": {
             "action": {"mode": "replace", "target_var": "title", "value": "x"}}}]}}
SUB = {"id": "dddd0001", "name": "Hero · Gear", "children": [_child(LIB[1])]}
OUTER = {"id": "eeee0001", "name": "Hero", "children": [
    _child(LIB[0]), DERIV, {"id": "dddd0001", "type": "bundle", "name": "Hero · Gear"}]}


def _base(bundles=(OUTER, SUB)):
    return pack.bundle_base(OUTER, list(bundles), LIB)


def test_bundle_base_reads_the_bundle():
    base = _base()
    assert [(i["key"], i["name"], i["section"]) for i in base["items"]] == [
        ("e1", "Class", ""), ("e2", "Weapon", "Hero · Gear")]
    assert base["sets"] == {"class": "Class", "title": "Title", "weapon": "Weapon"}
    assert not base["nested"] and list(base["subs"]) == ["Hero · Gear"]
    note = pack.base_note(base)
    assert "EXTENDING the bundle \"Hero\"" in note and "Title (derivation; sets $title)" in note
    assert "[in Hero · Gear]" in note
    holder = {"id": "ffff0001", "name": "All", "children": [
        {"id": "eeee0001", "type": "bundle", "name": "Hero"}]}
    nested = pack.bundle_base(OUTER, [OUTER, SUB, holder], LIB)
    assert nested["nested"]
    assert "can't hold sub-bundles" in pack.base_note(nested)


def _raw(items):
    return {"title": "", "summary": "", "items": items, "questions": []}


def test_compile_plan_keeps_the_bundle_and_adds_only_new_things():
    base = _base()
    raw = _raw([
        {"kind": "wildcard", "name": "Title", "var": "title", "count": 4},
        {"kind": "wildcard", "name": "Armor", "var": "armor", "count": 4, "tags": ["heavy"],
         "section": "Hero · Gear"},
        {"kind": "constraint", "name": "Class → Weapon", "source": "class", "target": "weapon",
         "about": "#magic never gets #blade"},
    ])
    plan = pack.compile_plan(raw, LIB, base=base)
    assert [i["name"] for i in plan["items"]] == ["Class", "Weapon", "Armor", "Class → Weapon"]
    assert plan["title"] == "Hero" and plan["base"]["sets"] == ["class", "title", "weapon"]
    assert any("already set by the bundle's Title" in w for w in plan["warnings"])
    # The constraint lives with its target, inside the existing sub-bundle.
    assert plan["items"][3]["section"] == "Hero · Gear"
    # Sent back from the manager, the bundle's items are rebuilt from the base.
    again = pack.compile_plan(plan, LIB, base=base)
    assert [(i["key"], i["id"]) for i in again["items"]] == [
        (i["key"], i["id"]) for i in plan["items"]]
    with pytest.raises(pack.PlanError, match="adds nothing"):
        pack.compile_plan(_raw([{"kind": "library", "name": "Class"}]), LIB, base=base)
    # A change to one of the bundle's own items is refused.
    with pytest.raises(pack.PlanError, match="already in the bundle"):
        pack.apply_change(plan, "e1", {"items": [{"kind": "wildcard", "name": "X", "var": "x"}]},
                          LIB, base)
    assert not any("no template" in f["text"] for f in pack.review_plan(plan, LIB))


def test_extend_ops_place_new_items_and_constraints_before_their_target():
    base = _base()
    plan = pack.compile_plan(_raw([
        {"kind": "wildcard", "name": "Armor", "var": "armor", "count": 4, "section": "Hero · Gear"},
        {"kind": "wildcard", "name": "Mood", "var": "mood", "count": 4},
        {"kind": "wildcard", "name": "Sky", "var": "sky", "count": 4, "section": "World"},
        {"kind": "constraint", "name": "Class → Weapon", "source": "class", "target": "weapon",
         "about": "#magic never gets #blade"},
    ]), LIB, base=base)
    key = {i["name"]: i["key"] for i in plan["items"]}
    built = {}
    for i in plan["items"]:
        if i["kind"] == "library":
            row = next(r for r in LIB if r["id"] == i["id"])
            built[i["key"]] = {"id": row["id"], "payload": row["payload"]}
        elif i["kind"] == "wildcard":
            built[i["key"]] = {"id": i["id"], "payload": _wild(i["id"], i["name"], i["var"])[
                "payload"]}
    built[key["Class → Weapon"]] = {"id": plan["items"][-1]["id"], "payload": {
        "source_wildcard_id": "aaaa0001", "target_wildcard_id": "bbbb0001", "rules": []}}
    chain = pack.extend_chain(plan, built, base)
    assert [m["name"] for m in chain] == [
        "Class", "Title", "Class → Weapon", "Weapon", "Armor", "Sky", "Mood"]
    ops = pack.extend_ops(plan, built, base, taken={"aaaa0001", "bbbb0001"},
                          template_ids=set(), bundle_ids={"dddd0001", "eeee0001"})
    assert [a["entity"]["name"] for a in ops["adds"]][-1] == "Hero · World"
    assert len(ops["adds"]) == 5
    by_id = {r["id"]: r["new_content"] for r in ops["replaces"]}
    assert [c["meta"]["name"] for c in by_id["dddd0001"]["children"]] == [
        "Class → Weapon", "Weapon", "Armor"]
    outer = by_id["eeee0001"]["children"]
    assert [c.get("name") or c["meta"]["name"] for c in outer] == [
        "Class", "Title", "Hero · Gear", "Hero · World", "Mood"]
    # The check runs the same order the install leaves.
    flat = []
    for c in outer:
        if c["type"] == "bundle":
            inner = by_id.get(c["id"]) or next(
                a["entity"] for a in ops["adds"] if a["entity"]["id"] == c["id"])
            flat += [x["meta"]["name"] for x in inner["children"]]
        else:
            flat.append(c["meta"]["name"])
    assert flat == [m["name"] for m in chain]
    assert ops["sub_bundles"][0]["name"] == "Hero · World"
