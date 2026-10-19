"""engine/ai/pack/graph.py — the pack graph, its compiler and the wiring."""
from __future__ import annotations

import pytest

from engine.ai import pack
from engine.ai.pack import graph as pg

GRAPH = {
    "title": "Fantasy heroes", "summary": "Fantasy character portraits.",
    "design": "Race anchors it; weapons follow race; a title follows class.",
    "rating": "safe", "style": "tags", "model": "", "anchor": "race",
    "questions": [], "assumptions": [], "from_images": [], "research": [],
    "run": {"mode": "single", "frames": 0}, "inputs": [], "sections": [],
    "slots": [
        {"name": "Race", "var": "race", "what": "fantasy races", "section": "", "count": 4,
         "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "kind", "values": ["elf", "dwarf", "human"]}]},
        {"name": "Class", "var": "class", "what": "adventurer classes", "section": "",
         "count": 4, "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "role", "values": ["caster", "martial"]}]},
        {"name": "Weapon", "var": "weapon", "what": "weapons", "section": "", "count": 5,
         "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "type", "values": ["gun", "blade", "staff"]}]},
        {"name": "Season", "var": "season", "what": "the season", "section": "", "count": 4,
         "show": "internal", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "season", "values": ["winter", "summer"]}]},
        {"name": "Outfit", "var": "outfit", "what": "full outfits", "section": "", "count": 6,
         "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "season", "values": ["winter", "summer"]}]},
    ],
    "fixed": [{"name": "Quality", "var": "quality", "text": "masterpiece, best quality",
               "negative": "lowres"}],
    "relations": [
        {"kind": "exclude", "from_slot": "Race", "from_axis": "kind", "from_value": "elf",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "gun", "factor": 0,
         "var": "", "text": "", "otherwise": ""},
        {"kind": "only", "from_slot": "Class", "from_axis": "role", "from_value": "caster",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "staff", "factor": 0,
         "var": "", "text": "", "otherwise": ""},
        {"kind": "agree", "from_slot": "Season", "from_axis": "season", "from_value": "",
         "to_slot": "Outfit", "to_axis": "", "to_value": "", "factor": 0,
         "var": "", "text": "", "otherwise": ""},
        {"kind": "derive", "from_slot": "Class", "from_axis": "role", "from_value": "caster",
         "to_slot": "", "to_axis": "", "to_value": "", "factor": 0,
         "var": "title", "text": "Archmage", "otherwise": "Adventurer"},
        {"kind": "append", "from_slot": "Season", "from_axis": "season", "from_value": "winter",
         "to_slot": "", "to_axis": "", "to_value": "", "factor": 0,
         "var": "outfit", "text": ", scarf", "otherwise": ""},
        # A reference the graph doesn't declare: reported, never guessed.
        {"kind": "exclude", "from_slot": "Race", "from_axis": "kind", "from_value": "orc",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "gun", "factor": 0,
         "var": "", "text": "", "otherwise": ""},
    ],
    "template": {"lead": "1girl, solo", "order": ["Quality", "$title", "Race", "Class",
                                                  "Weapon", "Season", "Outfit", "nothing"],
                 "tail": "", "negative": "bad anatomy"},
}

OPTIONS = {
    "Race": [("elf", {"kind": ["elf"]}), ("dark elf", {"kind": ["elf"]}),
             ("dwarf", {"kind": ["dwarf"]}), ("human", {"kind": ["human"]})],
    "Class": [("mage", {"role": "caster"}), ("sorcerer", {"role": "caster"}),
              ("knight", {"role": "martial"}), ("ranger", {"role": "martial"})],
    "Weapon": [("musket", {"type": ["gun"]}), ("flintlock pistol", {"type": ["gun"]}),
               ("longsword", {"type": ["blade"]}), ("dagger", {"type": ["blade"]}),
               ("oak staff", {"type": ["staff"]})],
    "Season": [("winter", {"season": "winter"}), ("summer", {"season": "summer"})],
    "Outfit": [("fur-lined cloak", {"season": ["winter"]}), ("wool coat", {"season": ["winter"]}),
               ("linen tunic", {"season": ["summer"]}), ("light dress", {"season": ["summer"]}),
               ("leather armor", {"season": ["winter", "summer"]})],
}


def _answer(name: str) -> dict:
    return {"options": [{"text": t, "weight": 1, "negative": "", "tags": tags}
                        for t, tags in OPTIONS[name]]}


def test_compile_graph_keeps_what_resolves_and_reports_the_rest():
    g = pg.compile_graph(GRAPH)
    assert [s["name"] for s in g["slots"]] == ["Race", "Class", "Weapon", "Season", "Outfit"]
    assert [r["kind"] for r in g["relations"]] == ["exclude", "only", "agree", "derive",
                                                   "append"]
    assert g["relations"][2]["values"] == ["winter", "summer"]
    assert g["bad_refs"] == ["exclude: Race.kind has no value orc"]
    assert g["template"]["order"] == ["quality", "title", "race", "class", "weapon", "outfit"]
    assert any("doesn't read Season" in w for w in g["warnings"])
    assert any("names nothing" in w for w in g["warnings"])
    assert g["anchor"] == "race"


def test_compile_graph_needs_a_slot():
    with pytest.raises(pack.PlanError):
        pg.compile_graph({"slots": []})


def _plan():
    g = pg.compile_graph(GRAPH)
    plan = pack.compile_plan(pg.graph_plan(g))
    plan["graph"] = g
    return plan


def test_graph_plan_items_and_order():
    plan = _plan()
    kinds = [(i["kind"], i["name"]) for i in plan["items"]]
    assert ("constraint", "Race → Weapon") in kinds
    assert ("constraint", "Class → Weapon") in kinds
    assert ("constraint", "Season → Outfit") in kinds
    assert ("derivation", "Title rule") in kinds
    assert ("derivation", "Outfit rule") in kinds
    assert ("fixed_values", "Quality") in kinds
    assert kinds[-1] == ("template", "Fantasy heroes")
    assert not plan["dropped"]
    season = next(i for i in plan["items"] if i["name"] == "Season")
    assert season["use"] == "internal"
    wired = [i["name"] for i in plan["items"] if pg.is_wired(plan, i["key"])]
    assert set(wired) == {"Quality", "Race → Weapon", "Class → Weapon", "Season → Outfit",
                          "Title rule", "Outfit rule", "Fantasy heroes"}
    assert pg.slot_for(plan, next(i["key"] for i in plan["items"] if i["name"] == "Race"))


def _build(plan):
    g = plan["graph"]
    built: dict = {}
    for key in pack.build_order(plan):
        item = next(i for i in plan["items"] if i["key"] == key)
        slot = pg.slot_for(plan, key)
        if slot is not None:
            out = pg.compile_slot(g, slot, _answer(slot["name"]))
        else:
            out = pg.wired_payload(plan, key, built)
        built[key] = {"id": item["id"], "payload": out["payload"]}
    return built


def test_slot_schema_and_compile_slot():
    plan = _plan()
    g = plan["graph"]
    weapon = pg.slot_by_var(g, "weapon")
    schema = pg.slot_schema(g, weapon)
    tags = schema["properties"]["options"]["items"]["properties"]["tags"]["properties"]
    assert tags["type"]["items"]["enum"] == ["gun", "blade", "staff"]
    cls = pg.slot_by_var(g, "class")
    role = pg.slot_schema(g, cls)["properties"]["options"]["items"]["properties"]["tags"]
    assert role["properties"]["role"]["enum"] == ["caster", "martial"]  # read by a rule
    out = pg.compile_slot(g, weapon, _answer("Weapon"))
    p = out["payload"]
    assert p["var_binding"] == "weapon"
    assert p["tag_groups"] == {"type": ["gun", "blade", "staff"]}
    assert p["tag_group_kinds"] == {"type": "classify"}
    assert sum(1 for o in p["options"] if o.get("fallback")) == 1  # narrowed slot
    assert pg.compile_slot(g, cls, _answer("Class"))["payload"]["tag_group_kinds"] == {
        "role": "accepts"}
    # An option with no value on an axis is left out and said.
    bad = {"options": [{"text": "x", "weight": 1, "negative": "", "tags": {}},
                       {"text": "bow", "weight": 1, "negative": "", "tags": {"type": ["blade"]}}]}
    out = pg.compile_slot(g, weapon, bad)
    assert [o["value"] for o in out["payload"]["options"]] == ["bow"]
    assert any("no type value" in w for w in out["warnings"])
    with pytest.raises(ValueError):
        pg.compile_slot(g, weapon, {"options": []})


def test_wired_payloads_and_a_clean_run():
    plan = _plan()
    built = _build(plan)
    by_name = {i["name"]: built[i["key"]]["payload"] for i in plan["items"]}
    assert by_name["Race → Weapon"]["matrix"] == {"elf": {"gun": {"mode": "exclude",
                                                                   "factor": 0}}}
    assert by_name["Class → Weapon"]["matrix"] == {"caster": {"staff": {"mode": "only",
                                                                        "factor": 1}}}
    assert by_name["Season → Outfit"]["matrix"]["winter"] == {"winter": {"mode": "only",
                                                                         "factor": 1}}
    title = by_name["Title rule"]["rules"][0]
    assert title["branches"][0]["condition"] == {"var": "class.role", "op": "equals",
                                                 "value": "caster"}
    assert title["else"]["action"]["value"] == "Adventurer"
    assert by_name["Outfit rule"]["rules"][0]["branches"][0]["action"]["mode"] == "append"
    assert by_name["Fantasy heroes"]["template_string"] == \
        "1girl, solo, $quality, $title, $race, $class, $weapon, $outfit"
    assert by_name["Quality"]["values"][0]["negative"] == "lowres"
    report = pack.check_pack(plan, built, seeds=60)
    assert report["failed"] == 0
    assert report["problems"] == {}, report["problems"]
    assert report["notes"] == [], report["notes"]
    prompts = [p["text"] for p in report["prompts"]]
    assert prompts
    for p in prompts:
        if "elf" in p.split(", ")[3]:
            assert "musket" not in p and "pistol" not in p
        if "mage" in p or "sorcerer" in p:
            assert "oak staff" in p and "Archmage" in p
        else:
            assert "Adventurer" in p
    vars_ = {v["var"]: v for v in report["variables"]}
    assert vars_["outfit"]["distinct"] >= 3


def test_wired_constraint_needs_both_wildcards():
    plan = _plan()
    key = next(i["key"] for i in plan["items"] if i["name"] == "Race → Weapon")
    with pytest.raises(pack.PlanError, match="build"):
        pg.wired_payload(plan, key, {})
