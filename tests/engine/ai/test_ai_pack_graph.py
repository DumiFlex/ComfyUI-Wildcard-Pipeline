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
         "var": "", "text": "", "otherwise": "", "words": ["musket"]},
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
                 "tail": "", "negative": "bad anatomy, musket in winter"},
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
    assert g["relations"][0]["words"] == ["musket"]
    assert g["bad_refs"] == ["exclude: Race.kind has no value orc"]
    # A rule written into the negative is taken out: rules are relations.
    assert g["template"]["negative"] == "bad anatomy"
    assert any("out of the negative" in w for w in g["warnings"])
    # A slot whose only axis is itself gets its options from the axis.
    assert pg.slot_by_var(g, "season")["self_axis"] == "season"
    assert pg.slot_by_var(g, "outfit")["self_axis"] == ""
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
    assert set(wired) == {"Quality", "Season", "Race → Weapon", "Class → Weapon",
                          "Season → Outfit", "Title rule", "Outfit rule", "Fantasy heroes"}
    assert pg.slot_for(plan, next(i["key"] for i in plan["items"] if i["name"] == "Race"))


def _build(plan):
    g = plan["graph"]
    built: dict = {}
    for key in pack.build_order(plan):
        item = next(i for i in plan["items"] if i["key"] == key)
        slot = pg.slot_for(plan, key)
        if slot is not None and not pg.is_wired(plan, key):
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
    season = by_name["Season"]
    assert [o["value"] for o in season["options"]] == ["winter", "summer"]
    assert season["tag_group_kinds"] == {"season": "accepts"}
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


def test_graph_answer_round_trips():
    plan = _plan()
    again = pg.compile_graph(pg.graph_answer(plan))
    assert pg.compile_graph(plan["graph"])["relations"] == again["relations"]  # idempotent
    assert again["relations"] == plan["graph"]["relations"]
    assert again["template"] == plan["graph"]["template"]
    assert again["bad_refs"] == []


def test_refs_schema_and_repair():
    g = pg.compile_graph(GRAPH)
    schema = pg.refs_schema(g)
    rel = schema["properties"]["relations"]["items"]["properties"]
    assert rel["from_slot"]["enum"] == ["Race", "Class", "Weapon", "Season", "Outfit"]
    assert "gun" in rel["to_value"]["enum"] and "orc" not in rel["to_value"]["enum"]
    assert "orc" in pg.refs_prompt(g) and "Race ($race): kind: elf, dwarf, human" in \
        pg.refs_prompt(g)
    fixed = pg.with_refs(g, {"relations": [
        {"kind": "exclude", "from_slot": "Race", "from_axis": "kind", "from_value": "dwarf",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "gun", "factor": 0,
         "var": "", "text": "", "otherwise": ""},
        {"kind": "exclude", "from_slot": "Race", "from_axis": "kind", "from_value": "orc",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "gun", "factor": 0,
         "var": "", "text": "", "otherwise": ""}]})
    assert len(fixed["relations"]) == len(g["relations"]) + 1
    assert fixed["bad_refs"] == ["exclude: Race.kind has no value orc"]
    # As many came back as were asked for, so the first try's miss isn't
    # listed as left out on top of the repair's own.
    assert fixed["dropped"] == []
    again = pg.compile_graph(fixed)
    assert again["dropped"] == ["exclude: Race.kind has no value orc"]
    assert pg.with_refs(g, {"relations": []}) is g


async def test_run_pack_on_the_graph_planner():
    calls: list[str] = []

    async def complete(**kw):
        calls.append(kw["schema_name"])
        if kw["schema_name"] == "pack_graph":
            return GRAPH
        if kw["schema_name"] == "pack_refs":
            return {"relations": []}
        assert kw["schema_name"] == "pack_slot"
        name = kw["user"].split('"')[1]
        assert "Other wildcards cover" in kw["user"]
        return _answer(name)

    result = await pack.run_pack(complete, "fantasy race, class and weapon; outfit by season, "
                                 "with 2 to 3 weapons each",
                                 seeds=40, settings={"planner": "graph"})
    assert result["failed"] == []
    # The eval compiles with the request, like the route: the pick is read off it.
    assert pg.slot_by_var(result["plan"]["graph"], "weapon")["pick"] == "2-3"
    assert calls.count("pack_graph") == 1 and calls.count("pack_refs") == 1
    assert calls.count("pack_slot") == 4  # one per slot; Season and wired items need none
    assert result["check"]["problems"] == {}, result["check"]["problems"]
    assert result["check"]["notes"] == []
    assert any("named nothing" in line for line in result["log"])
    assert result["plan"]["graph"]["slots"][0]["name"] == "Race"
    rels = result["check"]["relations"]
    assert [r["kind"] for r in rels] == ["exclude", "only", "agree", "derive", "append"]
    assert all(r["checked"] and r["holds"] and r["seen"] > 0 for r in rels), rels
    assert result["check"]["distinct"] > 0.5


# --- phase 3: fill calls, the scope check and relations verified on runs ----

def test_fill_call_adds_options_for_the_missing_axis_values():
    plan = _plan()
    g = plan["graph"]
    outfit = pg.slot_by_var(g, "outfit")
    key = next(i["key"] for i in plan["items"] if i["name"] == "Outfit")
    winter_only = {"options": [{"text": t, "weight": 1, "negative": "", "tags": tags}
                               for t, tags in OPTIONS["Outfit"][:2]]}
    first = pg.compile_slot(g, outfit, winter_only)
    assert first["warnings"] == ["No option is summer on season"]
    assert pack.repair_note(first["warnings"]) == "No option is summer on season"
    built = {key: {"id": "outfit01", "payload": first["payload"]}}
    assert pg.fill_gaps(g, outfit, first["payload"]) == {"season": ["summer"]}
    # The repair of a coverage note is a fill: add options, keep the rest.
    req = pg.slot_request(plan, key, first["warnings"][0], built)
    assert req["schema_name"] == "pack_slot_fill"
    add = req["schema"]["properties"]["add"]["items"]["properties"]["tags"]["properties"]
    assert add["season"]["items"]["enum"] == ["summer"]
    assert "No option is summer on season yet" in req["user"]
    assert "fur-lined cloak; wool coat" in req["user"]
    # A coverage part makes it a fill whatever else the note says: the
    # rest rides along for the new options. Any other note is a rebuild.
    mixed = pg.slot_request(plan, key, "\"red dress\" names what Colours picks; "
                            + first["warnings"][0], built)
    assert mixed["schema_name"] == "pack_slot_fill"
    assert ("The last options had these problems; the new ones must not: \"red dress\" "
            "names what Colours picks.") in mixed["user"]
    assert pg.coverage_split("a; No option is summer on season; b") == (
        ["No option is summer on season"], ["a", "b"])
    assert pg.fills(plan, key, "No option is summer on season") is True
    assert pg.fills(plan, key, "it repeats words") is False
    assert pg.slot_request(plan, key, "it repeats words", built)["schema_name"] == "pack_slot"
    assert pg.slot_request(plan, key, "", built)["schema_name"] == "pack_slot"
    answer = {"add": [{"text": "linen tunic", "weight": 1, "negative": "",
                       "tags": {"season": ["summer"]}},
                      {"text": "wool coat", "weight": 1, "negative": "",
                       "tags": {"season": ["summer"]}}]}
    out = pg.compile_slot(g, outfit, answer, existing=first["payload"])
    values = [o["value"] for o in out["payload"]["options"]]
    assert values == ["fur-lined cloak", "wool coat", "linen tunic"]  # the repeat is skipped
    old_ids = [o["id"] for o in first["payload"]["options"]]
    assert [o["id"] for o in out["payload"]["options"]][:2] == old_ids
    assert out["payload"]["tag_groups"] == {"season": ["winter", "summer"]}
    assert not any("No option is" in w for w in out["warnings"])
    assert sum(1 for o in out["payload"]["options"] if o.get("fallback")) == 1
    # An "add" with nothing to add to is a plain answer.
    plain = pg.compile_slot(g, outfit, answer)
    assert [o["value"] for o in plain["payload"]["options"]] == ["linen tunic", "wool coat"]


def test_scope_check_drops_twins_and_flags_bleed():
    plan = _plan()
    g = plan["graph"]
    built = _build(plan)
    key = next(i["key"] for i in plan["items"] if i["name"] == "Outfit")
    others = pg.other_texts(plan, built, key)
    assert "Outfit" not in others and others["Weapon"][0] == "musket"
    answer = {"options": [
        {"text": "wool coat", "weight": 1, "negative": "", "tags": {"season": ["winter"]}},
        {"text": "longsword", "weight": 1, "negative": "", "tags": {"season": ["summer"]}},
        {"text": "linen tunic, oak staff", "weight": 1, "negative": "",
         "tags": {"season": ["summer"]}},
    ]}
    out = pg.compile_slot(g, pg.slot_by_var(g, "outfit"), answer, others=others)
    assert [o["value"] for o in out["payload"]["options"]] == ["wool coat",
                                                               "linen tunic, oak staff"]
    assert 'Left out "longsword": Weapon already has it' in out["warnings"]
    bleed = next(w for w in out["warnings"] if "names what" in w)
    assert bleed == '"linen tunic, oak staff" names what Weapon picks ("oak staff"); ' \
        "leave that to Weapon"
    assert pack.repair_note(out["warnings"]) == bleed  # one rebuild is asked
    with pytest.raises(ValueError, match="names what another slot picks"):
        pg.compile_slot(g, pg.slot_by_var(g, "outfit"),
                        {"options": [{"text": "musket", "weight": 1, "negative": "",
                                      "tags": {"season": ["winter"]}}]}, others=others)


def test_fallback_is_never_what_a_rule_excludes():
    plan = _plan()
    g = plan["graph"]
    out = pg.compile_slot(g, pg.slot_by_var(g, "weapon"), _answer("Weapon"))
    fb = next(o for o in out["payload"]["options"] if o.get("fallback"))
    assert "gun" not in fb["sub_categories"]
    assert "staff" in fb["sub_categories"]  # the only row's value


def test_verify_relations_on_runs():
    plan = _plan()
    built = _build(plan)
    good = {"race": "elf", "class": "mage", "class.role": "caster", "weapon": "oak staff",
            "season": "winter", "season.season": "winter", "outfit": "wool coat, scarf",
            "title": "Archmage"}
    rels = pg.verify_relations(plan, built, [good])
    assert [(r["kind"], r["seen"], r["broken"], r["holds"]) for r in rels] == [
        ("exclude", 1, 0, True), ("only", 1, 0, True), ("agree", 1, 0, True),
        ("derive", 1, 0, True), ("append", 1, 0, True)]
    bad = {"race": "elf", "class": "knight", "class.role": "martial", "weapon": "musket",
           "season": "summer", "season.season": "summer", "outfit": "wool coat",
           "title": "Hero"}
    rels = pg.verify_relations(plan, built, [good, bad])
    by_kind = {r["kind"]: r for r in rels}
    assert by_kind["exclude"]["broken"] == 1 and not by_kind["exclude"]["holds"]
    assert by_kind["only"]["seen"] == 1 and by_kind["only"]["holds"]  # knight isn't a caster
    assert by_kind["agree"]["broken"] == 1  # summer with a winter coat
    assert by_kind["derive"]["seen"] == 2 and by_kind["derive"]["broken"] == 1  # else
    assert by_kind["append"]["seen"] == 1 and by_kind["append"]["holds"]
    assert pg.verify_relations(plan, {}, [good]) == [] or all(
        not r["checked"] for r in pg.verify_relations(plan, {}, [good]))
    # A pack-wide note names a broken rule.
    assert pg.verify_relations(plan, built, []) == []


def test_check_pack_notes_a_broken_rule(monkeypatch):
    plan = _plan()
    built = _build(plan)
    monkeypatch.setattr(pg, "verify_relations", lambda *_, **__: [
        {"text": "Race elf never gets Weapon gun", "kind": "exclude", "checked": True,
         "seen": 10, "broken": 2, "holds": False, "why": ""},
        {"text": "Class caster only gets Weapon staff", "kind": "only", "checked": True,
         "seen": 0, "broken": 0, "holds": False, "why": "never fired in 40 runs"}])
    report = pack.check_pack(plan, built, seeds=20)
    assert "Rule broken in 2 of 10 runs: Race elf never gets Weapon gun" in report["notes"]
    assert any(n.startswith("Rule never fired in the") and "only gets" in n
               for n in report["notes"])
    assert report["relations"][0]["holds"] is False


def test_rule_words_must_exist_and_are_read_in_the_prompts():
    plan = _plan()
    g = plan["graph"]
    weapon = pg.slot_by_var(g, "weapon")
    key = next(i["key"] for i in plan["items"] if i["name"] == "Weapon")
    assert pg.rule_words(g, weapon) == [("gun", "type", "musket")]
    assert "Include options that mention musket, tagged gun on type" in \
        pg.slot_prompt(g, weapon)
    # No option says the word: a warning the fill call plugs.
    answer = {"options": [{"text": "flintlock pistol", "weight": 1, "negative": "",
                           "tags": {"type": ["gun"]}},
                          {"text": "longsword", "weight": 1, "negative": "",
                           "tags": {"type": ["blade"]}},
                          {"text": "oak staff", "weight": 1, "negative": "",
                           "tags": {"type": ["staff"]}}]}
    out = pg.compile_slot(g, weapon, answer)
    assert out["warnings"] == ["No option mentions musket tagged gun on type"]
    assert pack.repair_note(out["warnings"]) == out["warnings"][0]
    built = {key: {"id": "weapon01", "payload": out["payload"]}}
    assert pg.fill_targets(g, weapon, out["payload"]) == {"type": {"gun": ["musket"]}}
    req = pg.slot_request(plan, key, out["warnings"][0], built)
    assert req["schema_name"] == "pack_slot_fill"
    assert "No option mentions musket yet" in req["user"] and "tagged gun on type" in req["user"]
    assert req["schema"]["properties"]["add"]["items"]["properties"]["tags"]["properties"][
        "type"]["items"]["enum"] == ["gun"]
    # With the word there, no warning.
    assert pg.compile_slot(g, weapon, _answer("Weapon"))["warnings"] == []
    # The check reads the rendered prompts: a musket in an elf's prompt breaks the rule.
    built = _build(plan)
    ctx = {"race": "elf", "class": "knight", "class.role": "martial", "weapon": "longsword",
           "season": "summer", "season.season": "summer", "outfit": "linen tunic",
           "title": "Adventurer"}
    held = pg.verify_relations(plan, built, [ctx], ["1girl, elf, knight, longsword"])
    assert held[0]["holds"] and held[0]["seen"] == 1
    broke = pg.verify_relations(plan, built, [ctx], ["1girl, elf, knight, musket, longsword"])
    assert broke[0]["broken"] == 1 and not broke[0]["holds"]
    # A rule whose value never fires in the runs doesn't hold either.
    never = pg.verify_relations(plan, built, [{**ctx, "race": "human"}])
    assert never[0]["seen"] == 0 and not never[0]["holds"] and "never fired" in never[0]["why"]
    assert never[0]["text"] == "Race elf never gets Weapon gun (musket)"


def test_self_axis_slot_is_written_by_code():
    plan = _plan()
    g = plan["graph"]
    season = pg.slot_by_var(g, "season")
    out = pg.axis_payload(g, season)
    assert [o["value"] for o in out["payload"]["options"]] == ["winter", "summer"]
    assert out["payload"]["tag_groups"] == {"season": ["winter", "summer"]}
    assert out["warnings"] == []
    # Season words aren't scope bleed for the other slots.
    key = next(i["key"] for i in plan["items"] if i["name"] == "Outfit")
    assert "Season" not in pg.other_texts(plan, _build(plan), key)
    # The round trip keeps it a self-axis slot.
    again = pg.compile_graph(pg.graph_answer(plan))
    assert pg.slot_by_var(again, "season")["self_axis"] == "season"
    assert again["relations"][0]["words"] == ["musket"]


def _graph(**changes) -> dict:
    g = {**GRAPH, "relations": [r for r in GRAPH["relations"] if r["from_value"] != "orc"],
         "slots": [dict(s) for s in GRAPH["slots"]]}
    g.update(changes)
    return g


def test_a_story_run_is_wired_by_the_code():
    held = [{**s, "hold": True} for s in GRAPH["slots"]]
    plan = pack.compile_graph_plan(_graph(run={"mode": "story", "frames": 3}, slots=held))
    beat = next(i for i in plan["items"] if i["var"] == "beat")
    assert beat["kind"] == "derivation" and "frame 1 to 3" in beat["about"]
    assert not pack.is_wired(plan, beat["key"])  # the model writes the beats
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert "$outfit, $beat." in tpl["about"]
    body = pack.wired_payload(plan, tpl["key"], {})["payload"]["template_string"]
    assert body.endswith("$outfit, $beat")
    # Everything was held: the cast and the outfit stay, the rest moves per frame.
    holds = {s["name"]: s["hold"] for s in plan["graph"]["slots"]}
    assert holds == {"Race": True, "Class": False, "Weapon": False, "Season": True,
                     "Outfit": True}
    assert any("Class, Weapon change from frame to frame" in w for w in plan["warnings"])
    # The review has nothing left to ask for the run.
    texts = " | ".join(f["text"] for f in pack.review_plan(plan))
    assert "Story over a Loop" not in texts and "every frame" not in texts
    # A plan sent back keeps its own run; a refine keeps the user's.
    again = pack.compile_graph_plan({**plan, "run": {"mode": "single", "frames": 0}})
    assert again["run"]["mode"] == "single" and not any(i["var"] == "beat"
                                                       for i in again["items"])
    refined = pack.compile_graph_plan(_graph(run={"mode": "single", "frames": 0}),
                                      previous=plan)
    assert refined["run"] == {"mode": "story", "frames": 3}
    assert any(i["var"] == "beat" for i in refined["items"])


def test_the_code_owns_the_story_beat():
    """Browser check 2026-10-19: a refine turned the code's beat derivation
    into a plain Beat wildcard that never read $iteration, so "Story over a
    Loop needs a derivation that sets the story beat" came back after
    every Fix all."""
    beat = {"name": "Beat", "var": "beat", "what": "story beats", "section": "", "count": 4,
            "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
            "axes": [{"name": "stage", "values": ["introduction", "climax"]}]}
    rels = [*GRAPH["relations"],
            {"kind": "exclude", "from_slot": "Beat", "from_axis": "stage",
             "from_value": "climax", "to_slot": "Weapon", "to_axis": "type",
             "to_value": "staff", "factor": 0, "var": "", "text": "", "otherwise": "",
             "words": []},
            {"kind": "derive", "from_slot": "Race", "from_axis": "kind", "from_value": "elf",
             "to_slot": "", "to_axis": "", "to_value": "", "factor": 0, "var": "beat",
             "text": "arrival", "otherwise": "", "words": []}]
    plan = pack.compile_graph_plan(_graph(run={"mode": "story", "frames": 3},
                                          slots=[*GRAPH["slots"], beat], relations=rels))
    assert not any(s["var"] == "beat" for s in plan["graph"]["slots"])
    assert not any(r.get("var") == "beat" or "Beat" in (r["from"]["slot"],
                                                         (r.get("to") or {}).get("slot"))
                   for r in plan["graph"]["relations"])
    [item] = [i for i in plan["items"] if i["var"] == "beat"]
    assert item["kind"] == "derivation" and "frame 1 to 3" in item["about"]
    [line] = plan["applied"]
    assert line.startswith("The code sets $beat from $iteration on a story: dropped the "
                           "planner's Beat")
    texts = " | ".join(f["text"] for f in pack.review_plan(plan))
    assert "Story over a Loop" not in texts
    # A single-image plan keeps a Beat slot the planner meant.
    single = pack.compile_graph_plan(_graph(slots=[*GRAPH["slots"], beat]))
    assert any(s["var"] == "beat" for s in single["graph"]["slots"])
    assert single["applied"] == []


def test_a_fix_all_request_is_not_the_users_words():
    assert pack.own_request("more hats") == "more hats"
    note = pack.review_note([{"text": "Add a hat slot"}])
    assert note.startswith(pack.REVIEW_NOTE_HEAD)
    assert pack.own_request("more hats\n" + note) == "more hats"
    assert pack.own_request(note) == ""
    # The page's own follow-up lines are not the user's words either (the
    # browser walk of 2026-10-21 asked for "answered, questions" on every
    # Fix all after the questions were answered).
    assert pack.own_request("I answered your questions.") == ""
    assert pack.own_request("Use what the searches found.\n" + note) == ""
    assert pack.own_request("more hats\nI edited the plan; keep my changes and fill any gaps "
                            "they leave.") == "more hats"
    # The request-words check sees only the user's words.
    g = pack.compile_graph(_graph())
    assert pack.request_gaps(g, pack.own_request(note)) == []
    assert pack.request_gaps(g, pack.own_request("I answered your questions.")) == []


def test_a_sweep_run_marks_the_axes_and_holds_the_rest():
    plan = pack.compile_graph_plan(_graph(run={"mode": "sweep", "frames": 0}))
    by = {i["name"]: i for i in plan["items"] if i["kind"] == "wildcard"}
    assert by["Race"]["about"].endswith("Sweep axis") and by["Class"]["about"].endswith(
        "Sweep axis")
    assert "Sweep axis" not in by["Weapon"]["about"] and by["Weapon"]["use"] == "hold"
    assert by["Season"]["use"] == "internal"  # internal: not swept, not held
    texts = " | ".join(f["text"] for f in pack.review_plan(plan))
    assert "sweep axis" not in texts
    # A slot marked sweep wins and is capped.
    marked = [{**s, "sweep": s["name"] == "Outfit", "count": 20} for s in GRAPH["slots"]]
    plan = pack.compile_graph_plan(_graph(run={"mode": "sweep", "frames": 0}, slots=marked))
    outfit = next(i for i in plan["items"] if i["name"] == "Outfit")
    assert outfit["count"] == pack.MAX_SWEEP_OPTIONS and outfit["about"].endswith("Sweep axis")
    assert next(i for i in plan["items"] if i["name"] == "Race")["use"] == "hold"


def test_the_model_setting_adds_the_quality_derivation():
    plan = pack.compile_graph_plan(_graph(), settings={"model": "family"})
    q = next(i for i in plan["items"] if i["name"] == "Model quality")
    assert q["var"] == "quality" and "$model_variant" in q["about"]
    assert not pack.is_wired(plan, q["key"])
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    # $quality is already first in the template, so the order holds.
    assert tpl["about"].startswith("Reads $quality, $title")
    assert "Per model family" not in " | ".join(f["text"] for f in pack.review_plan(plan))
    assert not any(i["name"] == "Model quality"
                   for i in pack.compile_graph_plan(_graph())["items"])


def test_an_axis_named_on_one_side_is_inferred_on_the_other():
    slots = [dict(s, axes=[]) if s["name"] == "Weapon" else s for s in GRAPH["slots"]]
    g = pack.compile_graph(_graph(slots=slots))
    # Nothing declares a type axis anywhere: nothing to copy, and the rules
    # that need it are reported for the repair call.
    assert next(s for s in g["slots"] if s["name"] == "Weapon")["axes"] == []
    assert g["bad_refs"] == ["exclude: Weapon has no axis type", "only: Weapon has no axis type"]
    # The source has it: the target gets a copy, and the rule resolves.
    slots = [dict(s, axes=[]) if s["name"] == "Outfit" else s for s in GRAPH["slots"]]
    rel = {"kind": "exclude", "from_slot": "Season", "from_axis": "season",
           "from_value": "winter", "to_slot": "Outfit", "to_axis": "season",
           "to_value": "summer", "factor": 0, "var": "", "text": "", "otherwise": "",
           "words": ["shorts"]}
    g = pack.compile_graph(_graph(slots=slots, relations=[rel]))
    outfit = next(s for s in g["slots"] if s["name"] == "Outfit")
    assert outfit["axes"] == [{"name": "season", "values": ["winter", "summer"]}]
    assert g["bad_refs"] == [] and g["relations"][0]["to"]["axis"] == "season"
    assert any("Outfit: added the season axis" in w for w in g["warnings"])


def test_agree_finds_the_shared_axis_under_two_names():
    slots = [dict(s, axes=[{"name": "fits", "values": ["winter", "summer"]}])
             if s["name"] == "Outfit" else s for s in GRAPH["slots"]]
    rel = {"kind": "agree", "from_slot": "Season", "from_axis": "season", "from_value": "",
           "to_slot": "Outfit", "to_axis": "", "to_value": "", "factor": 0,
           "var": "", "text": "", "otherwise": ""}
    g = pack.compile_graph(_graph(slots=slots, relations=[rel]))
    assert g["bad_refs"] == []
    assert g["relations"][0]["to"] == {"slot": "Outfit", "axis": "fits", "value": ""}
    assert g["relations"][0]["values"] == ["winter", "summer"]


def test_request_words_the_graph_never_says_are_a_finding():
    g = pack.compile_graph(_graph())
    assert pack.request_gaps(g, "") == []
    assert pack.request_gaps(g, "fantasy races, classes and weapons; outfits by season") == []
    gaps = pack.request_gaps(g, "Fantasy heroes: no sandals or shorts in winter, never a "
                                "parka in summer, 2 to 3 accessories each time")
    assert gaps == ["heroes", "sandals", "shorts", "parka", "accessories"]
    plan = pack.compile_graph_plan(_graph())
    [f] = [f for f in pack.review_plan(plan, request="no sandals in winter")
           if "The request names" in f["text"]]
    assert f["level"] == "fix" and f["text"].startswith("The request names sandals, and the "
                                                        "plan says it nowhere")
    # The graph plan's rules the code settles stay quiet in the review.
    texts = " | ".join(f["text"] for f in pack.review_plan(plan))
    assert "never empty" not in texts and "Nothing links" not in texts


def test_settings_land_on_the_graph_with_no_model_call():
    plan = pack.compile_graph_plan(
        _graph(sections=[{"name": "Looks", "about": "the look"}],
               slots=[{**s, "section": "Looks"} for s in GRAPH["slots"]]),
        settings={"count": 4, "style": "sentences", "rating": "nsfw", "structure": "flat"})
    g = plan["graph"]
    assert g["style"] == "sentences" and g["rating"] == "nsfw"
    assert plan["style"] == "sentences" and plan["rating"] == "nsfw"
    assert all(s["count"] <= 4 for s in g["slots"])
    assert g["sections"] == [] and all(not s["section"] for s in g["slots"])
    assert plan["applied"] == ["Style sentences, as set", "Rated nsfw, as set",
                               "4 options: capped Weapon, Outfit",
                               "One bundle: no sections"]
    # The same settings on a plan already at them change nothing more.
    again = pack.compile_graph_plan(plan, settings=plan["settings"])
    assert again["applied"] == []
    # A self-axis slot keeps its count: its options are its axis values.
    big = [{**s, "count": 8} for s in GRAPH["slots"]]
    plan = pack.compile_graph_plan(_graph(slots=big), settings={"count": 4})
    counts = {s["var"]: s["count"] for s in plan["graph"]["slots"]}
    assert counts["season"] == 8 and counts["race"] == 4


def test_hand_edits_are_locked_over_the_next_answer():
    first = pack.compile_graph_plan(_graph())
    # The user renamed Weapon's purpose, took out a relation and set the lead.
    first["graph"]["slots"][2]["what"] = "ranged and melee weapons"
    gone = pg.raw_rel_sig(pg.graph_answer(first)["relations"][0])
    first["graph"]["relations"] = first["graph"]["relations"][1:]
    first["graph"]["template"]["lead"] = "1boy, solo"
    first["locks"] = {"slots": ["weapon"], "removed_relations": [gone], "template": ["lead"],
                      "relations": [pg.raw_rel_sig(r) for r in pg.graph_answer(first)["relations"]
                                    if r["kind"] == "agree"]}
    shown = pack.compile_graph_plan(first, previous=first)
    assert shown["locks"]["slots"] == ["weapon"] and shown["applied"] == []
    assert pack.locks_note(shown).startswith("The user set these by hand and they stay")
    assert "the slots Weapon" in pack.locks_note(shown)
    assert "1 relation(s) they removed" in pack.locks_note(shown)
    # The model's next answer drops Weapon, writes the removed exclude again,
    # loses the agree relation and rewrites the lead: the user's parts win.
    answer = _graph(slots=[dict(s) for s in GRAPH["slots"] if s["var"] != "weapon"],
                    relations=[r for r in GRAPH["relations"]
                               if r["kind"] in ("exclude", "derive") and r["from_value"] != "orc"],
                    template={**GRAPH["template"], "lead": "1girl, solo, smile"})
    plan = pack.compile_graph_plan(answer, previous=shown)
    g = plan["graph"]
    weapon = next(s for s in g["slots"] if s["var"] == "weapon")
    assert weapon["what"] == "ranged and melee weapons"
    kinds = sorted(r["kind"] for r in g["relations"])
    assert kinds == ["agree", "derive"]
    assert g["template"]["lead"] == "1boy, solo"
    assert plan["locks"] == shown["locks"]
    assert plan["applied"] == ["Kept your Weapon slot", "Kept 1 relation you set",
                               "Kept the template lead you set"]


def test_locks_are_parsed_strictly():
    assert pg.parse_locks(None) == {"slots": [], "relations": [], "removed_relations": [],
                                    "template": []}
    got = pg.parse_locks({"slots": ["a", "a", 3, ""], "template": ["lead", "nope"], "x": 1})
    assert got["slots"] == ["a"] and got["template"] == ["lead"]
    assert pack.locks_note({"graph": None, "locks": got}) == ""


def test_findings_are_typed_so_a_rewording_keeps_its_id():
    held = [{**s, "hold": True} for s in GRAPH["slots"]]
    plan = pack.compile_graph_plan(_graph(run={"mode": "story", "frames": 3}, slots=held))
    # A finding's id is its type and refs, not its wording.
    gaps = pack.review_plan(plan, request="heroes with a parka and a hat")
    gap = next(f for f in gaps if f["type"] == "request_gap")
    fp = pack.fingerprint("request_gap", ["hat", "heroes", "parka"])
    assert gap["id"] == pack.finding_id("r", "", fp)
    assert pack.fingerprint("", ["x"]) == ""
    # The model's review can only point at items the pack has, and its
    # typed findings keep their id across rewordings; "other" goes by text.
    schema = pack.review_schema(plan)
    names = schema["properties"]["findings"]["items"]["properties"]["item"]["enum"]
    assert names[0] == "" and "Race" in names and "Weapon" in names
    race = next(i["key"] for i in plan["items"] if i["name"] == "Race")
    first = pack.compile_review({"findings": [
        {"item": "Race", "type": "mixed_slot", "severity": "fix",
         "text": "Race mixes races and ages"},
        {"item": "Subject", "type": "missing_slot", "severity": "fix", "text": "No subject slot"},
        {"item": "", "type": "nope", "severity": "tip", "text": "Looks fine otherwise"},
    ]}, plan)
    # On a graph plan a free "other" nit (a rename, a shorter text) is dropped.
    assert [(f["key"], f["type"]) for f in first] == [(race, "mixed_slot")]
    types = schema["properties"]["findings"]["items"]["properties"]["type"]["enum"]
    assert "other" not in types and "mixed_slot" in types
    again = pack.compile_review({"findings": [
        {"item": "Race", "type": "mixed_slot", "severity": "fix", "text": "Race holds ages too"},
    ]}, plan)
    assert again[0]["id"] == first[0]["id"]
    # Two findings of one kind on one item join; neither is lost.
    two = pack.compile_review({"findings": [
        {"item": "", "type": "missing_slot", "severity": "fix", "text": "Add a Lighting slot"},
        {"item": "", "type": "missing_slot", "severity": "fix", "text": "Add a Pose slot"},
    ]}, plan)
    assert [f["text"] for f in two] == ["Add a Lighting slot; Add a Pose slot"]
    # On an item-list plan an unknown item is the whole pack, as before.
    flat = pack.compile_plan({"title": "x", "items": [
        {"kind": "wildcard", "name": "A", "var": "a", "about": "a", "count": 4, "tags": [],
         "section": "", "source": "", "target": "", "use": ""}]})
    zed = pack.compile_review({"findings": [{"item": "Zed", "text": "Add Zed"}]}, flat)
    assert zed[0]["key"] == ""
    # The graph review prompt carries the axes and the prompt order.
    prompt = pack.review_prompt(plan, [], "heroes")
    assert "Axes: Race: kind (elf, dwarf, human)" in prompt and "Prompt order: " in prompt


def test_the_code_asks_about_the_run_and_the_sweep_axes():
    # A request that reads like a story on a single-image plan: the code
    # asks, with what the answer sets, and stops once it is answered.
    plan = pack.compile_graph_plan(_graph(), request="a 6 frame comic of a hero's day")
    q = plan["questions"][-1]
    assert q["header"] == "Story or single" and q["multi"] is False
    assert q["choices"] == ["A story of 6 frames", "Single images"]
    assert q["binds"] == {"set": "run", "frames": 6}
    answered = [{"question": q["question"], "answer": "Single images"}]
    plan = pack.compile_graph_plan(_graph(), request="a 6 frame comic", decisions=answered)
    assert all(not x.get("binds") for x in plan["questions"])
    plan = pack.compile_graph_plan(_graph(run={"mode": "story", "frames": 6}),
                                   request="a 6 frame comic")
    assert all(not x.get("binds") for x in plan["questions"])
    assert not pack.code_questions(plan["graph"], "fantasy heroes")
    # A sweep run with no axis marked asks which slots to compare.
    plan = pack.compile_graph_plan(_graph(run={"mode": "sweep", "frames": 0}))
    q = plan["questions"][-1]
    assert q["header"] == "Sweep axes" and q["multi"] is True
    assert q["choices"] == ["Race", "Class", "Weapon", "Outfit"]
    assert q["binds"] == {"set": "sweep"}
    marked = [{**s, "sweep": s["var"] == "race"} for s in GRAPH["slots"]]
    plan = pack.compile_graph_plan(_graph(run={"mode": "sweep", "frames": 0}, slots=marked))
    assert all(not x.get("binds") for x in plan["questions"])


def test_the_template_reads_every_value_and_single_runs_hold_nothing():
    held = [{**s, "hold": True} for s in GRAPH["slots"]]
    tpl = {**GRAPH["template"], "lead": "1girl, solo, {{quality}}, {{mood}}, best",
           "order": ["Race"]}
    plan = pack.compile_graph_plan(_graph(slots=held, template=tpl),
                                   request="animal portraits of lions")
    t = plan["graph"]["template"]
    # Every prompt slot, fixed value and derived variable is read; a
    # placeholder the graph can resolve becomes its variable (read in the
    # lead, so not again in the order), the rest goes.
    assert t["order"] == ["race", "class", "weapon", "outfit", "title"]
    assert t["lead"] == "$quality, best"
    assert not any("Added $quality" in w for w in plan["warnings"])
    assert any("Took {mood} out of the template text" in w for w in plan["warnings"])
    # Single images hold nothing, and a person the request never asked for
    # leaves the lead.
    assert not any(s["hold"] for s in plan["graph"]["slots"])
    assert plan["applied"] == ["Single images: nothing held (Race, Class, Weapon, Season, "
                               "Outfit vary)",
                               'Took "1girl, solo" out of the lead: the request names no person']
    # A request with a person keeps its lead; a story keeps its holds.
    plan = pack.compile_graph_plan(_graph(slots=held, template=tpl), request="elf heroines")
    assert plan["graph"]["template"]["lead"].startswith("1girl, solo")
    plan = pack.compile_graph_plan(_graph(slots=held, run={"mode": "story", "frames": 3}),
                                   request="a 3 frame story of a lion")
    assert next(s for s in plan["graph"]["slots"] if s["var"] == "race")["hold"] is True
    assert pg.unasked_lead("1boy, scenery", "mountain landscapes") == ("scenery", ["1boy"])
    assert pg.unasked_lead("1boy, scenery", "") == ("1boy, scenery", [])


async def test_a_rebuilt_slot_that_still_misses_a_value_gets_one_fill():
    # A rebuild for another reason came back without summer options (9B,
    # 2026-10-20: rules on values no option carried were most of the
    # broken ones); the rebuilt slot gets one fill, never a second.
    outfit_calls: list[str] = []

    async def complete(**kw):
        if kw["schema_name"] == "pack_graph":
            return GRAPH
        if kw["schema_name"] == "pack_refs":
            return {"relations": []}
        name = kw["user"].split('"')[1]
        if name != "Outfit":
            return _answer(name)
        outfit_calls.append(kw["schema_name"])
        if len(outfit_calls) == 1:
            # Full coverage, but one option names another slot's pick.
            return {"options": _answer("Outfit")["options"]
                    + [{"text": "longsword belt", "weight": 1, "negative": "",
                        "tags": {"season": ["winter"]}}]}
        if len(outfit_calls) == 2:
            assert kw["schema_name"] == "pack_slot"
            return {"options": [{"text": t, "weight": 1, "negative": "", "tags": tags}
                                for t, tags in OPTIONS["Outfit"][:2]]}
        assert kw["schema_name"] == "pack_slot_fill"
        return {"add": [{"text": t, "weight": 1, "negative": "", "tags": tags}
                        for t, tags in OPTIONS["Outfit"][2:]]}

    result = await pack.run_pack(complete, "fantasy heroes; outfit by season", seeds=10,
                                 repairs=0, settings={"planner": "graph"})
    assert outfit_calls == ["pack_slot", "pack_slot", "pack_slot_fill"]
    outfit = next(i for i in result["plan"]["items"] if i["name"] == "Outfit")
    values = [o["value"] for o in result["built"][outfit["key"]]["payload"]["options"]]
    assert "linen tunic" in values and "fur-lined cloak" in values
    assert any(" fix: " in line and "No option is summer on season" in line
               for line in result["log"]), result["log"]


def test_pick_names_in_the_template_text_are_reads_and_defects_go_to_the_negative():
    tpl = {**GRAPH["template"], "lead": "Quality, class, ugly, (deformed:1.2), 1girl",
           "tail": "bad anatomy, cinematic", "order": ["Race"], "negative": "lowres"}
    plan = pack.compile_graph_plan(_graph(template=tpl), request="elf heroines")
    t = plan["graph"]["template"]
    assert t["lead"] == "$quality, $class, 1girl" and t["tail"] == "cinematic"
    assert t["negative"] == "lowres, ugly, (deformed:1.2), bad anatomy"
    assert "quality" not in t["order"] and "class" not in t["order"]
    tpl_key = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    body = pack.wired_payload(plan, tpl_key, {})["payload"]["template_string"]
    assert body.startswith("$quality, $class, 1girl, $race") and body.count("$quality") == 1
    assert any(w.startswith("The template text names Quality, class as words")
               for w in plan["warnings"])
    assert any(w.startswith("Moved ugly, (deformed:1.2), bad anatomy from the template text")
               for w in plan["warnings"])
    # A look that contains a defect word stays.
    plan = pack.compile_graph_plan(_graph(template={**GRAPH["template"],
                                                    "lead": "blurry background, 1girl"}))
    assert plan["graph"]["template"]["lead"] == "blurry background, 1girl"


def test_request_gaps_skip_build_words_and_possessives_and_are_asked_once():
    g = pg.compile_graph(_graph())
    # "character's" is the character; how to build the pack is not a gap.
    assert pack.request_gaps(g, "an elf's race and class; small and specialized, "
                             "separation of concerns, your call (decide for me), none") == []
    assert pack.request_gaps(g, "an elf's parka") == ["parka"]
    first = pack.compile_graph_plan(_graph(), request="an elf with a parka")
    assert first["request_gaps"] == ["parka"] and first["gaps_tried"] == []
    assert any(f["type"] == "request_gap" for f in
               pack.review_plan(first, request="an elf with a parka"))
    # A refine that still says nothing about it: asked once, then a tip.
    again = pack.compile_graph_plan(_graph(), previous=first, request="an elf with a parka")
    assert again["gaps_tried"] == ["parka"]
    findings = pack.review_plan(again, request="an elf with a parka")
    assert not any(f["type"] == "request_gap" for f in findings)
    left = next(f for f in findings if f["type"] == "request_gap_left")
    assert left["level"] == "tip" and "parka" in left["text"]
    # The manager sends the plan back: the memory rides on it.
    back = pack.compile_graph_plan(again, settings=again["settings"],
                                   request="an elf with a parka")
    assert back["gaps_tried"] == ["parka"]
    # A refine that placed it clears it.
    placed = pack.compile_graph_plan(
        _graph(template={**GRAPH["template"], "lead": "parka"}), previous=again,
        request="an elf with a parka")
    assert placed["request_gaps"] == [] and placed["gaps_tried"] == []


def test_template_text_a_fixed_value_already_says_goes():
    # Sonnet walkthrough, 2026-10-21: the Pony+Flux pack's lead repeated
    # "clean lineart" from its style preset, so every prompt said it twice.
    fixed = [{"name": "Style preset", "var": "style",
              "text": "(clean lineart:1.1), flat colors, masterpiece", "negative": ""}]
    tpl = {**GRAPH["template"], "lead": "clean lineart, 1girl, solo",
           "tail": "cinematic, flat_colors"}
    plan = pack.compile_graph_plan(_graph(fixed=[*GRAPH["fixed"], *fixed], template=tpl))
    t = plan["graph"]["template"]
    assert t["lead"] == "1girl, solo" and t["tail"] == "cinematic"
    assert "style" in t["order"]
    assert any(w.startswith("Took clean lineart (Style preset), flat_colors (Style preset) "
                            "out of the template text") for w in plan["warnings"])


def test_a_scope_rebuild_hears_every_clashing_word_of_its_neighbour():
    # Sonnet rules pack (2026-10-21): Race and Body both carried skin and
    # eye words, and each rebuild only heard the words of its own problem,
    # so they swapped clashes for two rounds.
    slot = {"section": "", "count": 3, "show": "prompt", "pick": "", "hold": False,
            "sometimes_none": 0, "axes": []}
    g = {**GRAPH, "relations": [], "fixed": [],
         "slots": [{**slot, "name": "Race", "var": "race", "what": "fantasy races"},
                   {**slot, "name": "Body", "var": "body", "what": "body features"},
                   {**slot, "name": "Setting", "var": "setting", "what": "places"}],
         "template": {"lead": "", "order": ["Race", "Body", "Setting"], "tail": "", "negative": ""}}
    plan = pack.compile_graph_plan(g)
    keys = {i["name"]: i["key"] for i in plan["items"]}

    def built_of(name, values):
        opts = [{"id": f"o{n}", "value": v, "weight": 1, "sub_categories": []}
                for n, v in enumerate(values)]
        return {"id": f"{name[:4].lower()}0001",
                "payload": {"var_binding": name.lower(), "options": opts, "sub_categories": []}}
    built = {
        keys["Race"]: built_of("Race", ["elf, pointy ears, tan skin, freckles",
                                        "dwarf, pale skin"]),
        keys["Body"]: built_of("Body", ["slender, fair skin", "athletic, sharp eyes", "freckles"]),
        keys["Setting"]: built_of("Setting", ["forest, tall trees", "castle hall"]),
    }
    clash = pg.clash_words(plan, built, keys["Body"])
    assert clash == {"Race": ["tan skin", "freckles", "pale skin"]}
    req = pg.slot_request(plan, keys["Body"], "its options already name what $race (Race) picks: "
                          "\"tan skin\"; leave those to Race", built)
    assert ("Race already says: tan skin, freckles, pale skin. Keep every one of these out"
            in req["user"])
    # Not on a rebuild for another reason.
    assert "already says" not in pg.slot_request(plan, keys["Body"], "more variety", built)["user"]
