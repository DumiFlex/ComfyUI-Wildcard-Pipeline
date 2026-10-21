"""The pack-sheet round (2026-10-19): rolled sources so rules don't empty
the pool, the ``draw`` relation (a shared list in front of options), picks
read off the request, two model families, and the fallback-rate note."""
from __future__ import annotations

import copy

import pytest

from engine.ai import pack
from engine.ai.pack import check as pack_check
from engine.ai.pack import graph as pg


def _slot(name, var, what, axes, **more):
    return {"name": name, "var": var, "what": what, "section": "", "count": 4,
            "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
            "axes": axes, **more}


def _rel(kind, from_slot, from_axis="", from_value="", to_slot="", to_axis="", to_value="",
         **more):
    return {"kind": kind, "from_slot": from_slot, "from_axis": from_axis,
            "from_value": from_value, "to_slot": to_slot, "to_axis": to_axis,
            "to_value": to_value, "factor": 0, "var": "", "text": "", "otherwise": "",
            "words": [], **more}


def _graph(slots, relations, order, **more):
    return {"title": "Pack", "summary": "", "design": "", "rating": "safe", "style": "tags",
            "model": "", "anchor": "", "questions": [], "assumptions": [], "from_images": [],
            "research": [], "run": {"mode": "single", "frames": 0}, "inputs": [],
            "sections": [], "slots": slots, "fixed": [], "relations": relations,
            "template": {"lead": "", "order": order, "tail": "", "negative": ""}, **more}


def _answer(rows):
    return {"options": [{"text": t, "weight": 1, "negative": "", "tags": tags}
                        for t, tags in rows]}


def _build(plan, answers):
    g = plan["graph"]
    built: dict = {}
    for key in pack.build_order(plan):
        item = next(i for i in plan["items"] if i["key"] == key)
        slot = pg.slot_for(plan, key)
        if slot is not None and not pg.is_wired(plan, key):
            out = pg.compile_slot(g, slot, _answer(answers[slot["name"]]),
                                  refs=pg.draw_refs(plan, built))
        else:
            out = pg.wired_payload(plan, key, built)
        built[key] = {"id": item["id"], "payload": out["payload"]}
    return built


LANDSCAPE = _graph(
    [_slot("Biome", "biome", "biomes", [{"name": "climate", "values": ["cold", "hot"]}]),
     _slot("Weather", "weather", "weather", [{"name": "climate", "values": ["cold", "hot"]}])],
    [_rel("agree", "Biome", "climate", to_slot="Weather", to_axis="climate")],
    ["Biome", "Weather"])
LANDSCAPE_OPTIONS = {
    # A mountain fits both climates: the engine must roll ONE of them, or
    # the two allow-list rows fire together and nothing is left.
    "Biome": [("mountain", {"climate": ["cold", "hot"]}), ("desert", {"climate": ["hot"]}),
              ("tundra", {"climate": ["cold"]})],
    "Weather": [("snow", {"climate": ["cold"]}), ("sleet", {"climate": ["cold"]}),
                ("heat haze", {"climate": ["hot"]}), ("dust storm", {"climate": ["hot"]})],
}


def test_an_agree_source_rolls_one_value_so_its_rows_never_empty_the_target():
    plan = pack.compile_graph_plan(LANDSCAPE)
    g = plan["graph"]
    biome, weather = pg.slot_by_var(g, "biome"), pg.slot_by_var(g, "weather")
    assert pg.axis_kinds(g, biome) == {"climate": "accepts"}
    assert pg.axis_kinds(g, weather) == {"climate": "classify"}
    built = _build(plan, LANDSCAPE_OPTIONS)
    by_name = {i["name"]: built[i["key"]]["payload"] for i in plan["items"]}
    mountain = next(o for o in by_name["Biome"]["options"] if o["value"] == "mountain")
    assert mountain["sub_categories"] == ["cold", "hot"]  # alternatives, kept
    assert by_name["Biome"]["tag_group_kinds"] == {"climate": "accepts"}
    report = pack.check_pack(plan, built, seeds=60)
    assert report["failed"] == 0
    assert report["fallbacks"] == {}, report["problems"]
    assert [r["holds"] for r in report["relations"]] == [True]
    for p in report["prompts"]:
        biome_text, weather_text = p["text"].split(", ")[:2]
        if biome_text == "tundra":
            assert weather_text in ("snow", "sleet")
        if biome_text == "desert":
            assert weather_text in ("heat haze", "dust storm")


def test_picked_tags_follow_the_rolled_value_on_an_accepts_axis():
    plan = pack.compile_graph_plan(LANDSCAPE)
    built = _build(plan, LANDSCAPE_OPTIONS)
    payloads = {pg.slot_for(plan, i["key"])["name"]: built[i["key"]]["payload"]
                for i in plan["items"] if i["kind"] == "wildcard"}
    tags, fell = pg._picked_tags(plan["graph"], payloads, "Biome",
                                 {"biome": "mountain", "biome.climate": "hot"})
    assert tags == {"hot"} and not fell
    # A run where the mountain rolled hot but the weather is cold breaks the agree.
    rels = pg.verify_relations(plan, built, [{"biome": "mountain", "biome.climate": "hot",
                                             "weather": "sleet"}])
    assert rels[0]["broken"] == 1


def test_an_only_source_rolls_one_value_too():
    g = pack.compile_graph(_graph(
        [_slot("Biome", "biome", "biomes", [{"name": "climate", "values": ["cold", "hot"]}]),
         _slot("Weather", "weather", "weather", [{"name": "kind", "values": ["snow", "sun"]}])],
        [_rel("only", "Biome", "climate", "cold", "Weather", "kind", "snow"),
         _rel("only", "Biome", "climate", "hot", "Weather", "kind", "sun")],
        ["Biome", "Weather"]))
    assert pg.axis_kinds(g, pg.slot_by_var(g, "biome")) == {"climate": "accepts"}
    # Exclude sources stay classify: two tags are two statements, both true.
    g2 = pack.compile_graph(_graph(
        [_slot("Biome", "biome", "biomes", [{"name": "climate", "values": ["cold", "hot"]}]),
         _slot("Weather", "weather", "weather", [{"name": "kind", "values": ["snow", "sun"]}])],
        [_rel("exclude", "Biome", "climate", "hot", "Weather", "kind", "snow")],
        ["Biome", "Weather"]))
    assert pg.axis_kinds(g2, pg.slot_by_var(g2, "biome")) == {"climate": "classify"}


WINTER = _graph(
    [_slot("Colours", "colour", "colours", [{"name": "warmth", "values": ["warm", "cool"]}]),
     _slot("Scarf", "scarf", "scarves", []), _slot("Hat", "hat", "hats", [])],
    [_rel("draw", "Colours", "warmth", "warm", "Scarf"),
     _rel("draw", "Colours", to_slot="Hat"),
     _rel("draw", "Scarf", to_slot="Scarf")],
    ["Scarf", "Hat"])
WINTER_OPTIONS = {
    "Colours": [("red", {"warmth": ["warm"]}), ("orange", {"warmth": ["warm"]}),
                ("blue", {"warmth": ["cool"]})],
    "Scarf": [("knitted scarf", {}), ("silk scarf", {})],
    "Hat": [("beanie", {}), ("beret", {})],
}


def test_a_draw_relation_puts_a_fresh_pick_in_front_of_every_option():
    g = pack.compile_graph(WINTER)
    kinds = [r["kind"] for r in g["relations"]]
    assert kinds == ["draw", "draw"]
    assert g["bad_refs"] == ["draw: Scarf from itself"]
    assert g["relations"][0]["from"] == {"slot": "Colours", "axis": "warmth", "value": "warm"}
    assert g["relations"][0]["to"] == {"slot": "Scarf", "axis": "", "value": ""}
    # A list only drawn from is no pick of its own: internal, out of the order.
    assert pg.slot_by_var(g, "colour")["show"] == "internal"
    assert g["template"]["order"] == ["scarf", "hat"]
    assert any("Colours is a list" in w for w in g["warnings"])
    plan = pack.compile_graph_plan(WINTER)
    assert [i["kind"] for i in plan["items"]].count("constraint") == 0
    assert [i["name"] for i in plan["items"] if i["kind"] == "wildcard"][0] == "Colours"
    scarf = pg.slot_by_var(plan["graph"], "scarf")
    prompt = pg.slot_prompt(plan["graph"], scarf)
    assert "fresh pick from Colours (warm) in front of every option, so write no colours" \
        in prompt
    # Without the list built, the ref can't be written and the slot says so.
    out = pg.compile_slot(plan["graph"], scarf, _answer(WINTER_OPTIONS["Scarf"]))
    assert any("isn't built yet" in w for w in out["warnings"])
    assert out["payload"]["options"][0]["value"] == "knitted scarf"
    built = _build(plan, WINTER_OPTIONS)
    by_name = {i["name"]: built[i["key"]] for i in plan["items"]}
    cid = by_name["Colours"]["id"]
    assert [o["value"] for o in by_name["Scarf"]["payload"]["options"]] == [
        f"@{{{cid}:warm}} knitted scarf", f"@{{{cid}:warm}} silk scarf"]
    assert by_name["Hat"]["payload"]["options"][0]["value"] == f"@{{{cid}}} beanie"
    assert pg.verify_relations(plan, built, [{"scarf": "red knitted scarf"}]) == [
        {"text": "Scarf options each start with a fresh Colours pick (warm)", "kind": "draw",
         "checked": False, "seen": 0, "broken": 0, "holds": True, "why": ""},
        {"text": "Hat options each start with a fresh Colours pick", "kind": "draw",
         "checked": False, "seen": 0, "broken": 0, "holds": True, "why": ""}]
    report = pack.check_pack(plan, built, seeds=30)
    assert report["failed"] == 0 and report["problems"] == {}, report["problems"]
    for p in report["prompts"]:
        scarf_text, hat_text = p["text"].split(", ")
        assert scarf_text.split(" ")[0] in ("red", "orange")
        assert hat_text.split(" ")[0] in ("red", "orange", "blue")
    # The pack's own compile path doesn't call the ref a disagreement.
    key = next(i["key"] for i in plan["items"] if i["name"] == "Scarf")
    out = pack.compile_item(plan, key, built, _answer(WINTER_OPTIONS["Scarf"]))
    assert not any("points at" in w for w in out["warnings"]), out["warnings"]
    # The eval's feature check sees it.
    assert ":" in out["payload"]["options"][0]["value"]
    # A plan sent back keeps the relation.
    again = pack.compile_graph(pg.graph_answer(plan))
    assert [r["kind"] for r in again["relations"]] == ["draw", "draw"]


def test_picks_the_request_counts_land_on_the_slot():
    assert pg.request_picks("carrying 2 to 3 accessories each") == [(2, 3, "accessories")]
    assert pg.request_picks("two or three props, 3-2 charms, three hats") == [
        (2, 3, "props"), (2, 3, "charms"), (3, 3, "hats")]
    # How the pack runs is no pick: frames, options, images.
    assert pg.request_picks(
        "a 4-frame story with 8 options per wildcard and 3 images") == []
    assert pg.request_picks("one hat") == []
    g = _graph([_slot("Hero", "hero", "heroes", []),
                _slot("Accessories", "accessory", "small items a hero carries", [])],
               [], ["Hero", "Accessories"])
    plan = pack.compile_graph_plan(g, request="Fantasy adventurers carrying 2 to 3 "
                                              "accessories each.")
    acc = pg.slot_by_var(plan["graph"], "accessory")
    assert acc["pick"] == "2-3"
    assert "Accessories: pick 2-3, from the request" in plan["applied"]
    assert next(i for i in plan["items"] if i["name"] == "Accessories")["use"] == "pick 2-3"
    assert pg.slot_by_var(plan["graph"], "hero")["pick"] == ""
    # The model's own pick wins; a slot that is its own axis isn't counted.
    g["slots"][1]["pick"] = "4"
    plan = pack.compile_graph_plan(g, request="2 to 3 accessories")
    assert pg.slot_by_var(plan["graph"], "accessory")["pick"] == "4"
    assert plan["applied"] == []


def test_two_model_families_add_the_quality_rule_without_the_setting():
    assert pg.model_families({"model": "pony, flux"}) == ["pony", "flux"]
    assert pg.model_families({"model": "Pony and Flux"}) == ["pony", "flux"]
    assert pg.model_families({"model": "illustrious"}) == ["illustrious"]
    assert pg.model_families({"model": ""}) == []
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"], model="pony, flux")
    plan = pack.compile_graph_plan(g)
    q = next(i for i in plan["items"] if i["name"] == "Model quality")
    assert q["var"] == "quality" and "runs on pony, flux" in q["about"]
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert tpl["about"].startswith("Reads $quality, $hero")
    one = pack.compile_graph_plan(_graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"],
                                         model="pony"))
    assert not any(i["name"] == "Model quality" for i in one["items"])


def test_rules_that_empty_the_pool_most_runs_are_a_note():
    plan = pack.compile_graph_plan(_graph(
        [_slot("Biome", "biome", "biomes", [{"name": "climate", "values": ["cold", "hot"]}]),
         _slot("Weather", "weather", "weather", [{"name": "kind", "values": ["snow", "sun"]}])],
        [_rel("only", "Biome", "climate", "cold", "Weather", "kind", "snow")],
        ["Biome", "Weather"]))
    # No weather is snow, so a cold biome always leaves nothing: fallback.
    built = _build(plan, {"Biome": [("tundra", {"climate": ["cold"]}),
                                    ("desert", {"climate": ["hot"]})],
                          "Weather": [("sun", {"kind": ["sun"]}), ("haze", {"kind": ["sun"]})]})
    report = pack.check_pack(plan, built, seeds=40)
    wkey = next(i["key"] for i in plan["items"] if i["name"] == "Weather")
    assert set(report["fallbacks"]) == {wkey} and report["fallbacks"][wkey] >= 10
    [note] = [n for n in report["notes"] if "fallback stands in" in n]
    assert note.startswith("Weather: its rules leave nothing in ")
    assert "Biome cold only gets Weather snow" in note
    assert pack_check._tight_rules(plan, {wkey: 3}, 40) == []  # under the share


def test_eval_scores_the_worst_fallback_share(tmp_path):
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "ai_pack_evals", Path(__file__).resolve().parents[3] / "scripts" / "ai_pack_evals.py")
    evals = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evals)
    result = {"plan": {"items": [{"key": "a", "kind": "wildcard"}]}, "built": {"a": {}},
              "check": {"runs": 40, "fallbacks": {"a": 30}, "problems": {}, "notes": [],
                        "relations": [], "prompts": [], "distinct": 1.0}}
    assert evals._score(result)["fell"] == 0.75
    result["check"]["fallbacks"] = {}
    assert evals._score(result)["fell"] == 0
    text = evals.report([{"request": "x", "plan": True, "built": 1, "items": 1, "problems": 0,
                          "clean": True, "built_share": 1, "fell": 0.75, "seconds": 1,
                          "prompts": [], "check": True, "distinct": 1.0, "relations": 0,
                          "held": 0}], "m")
    assert "fell back in 30% or more of the runs: 1 / 1" in text
    assert "| 75% |" in text


def test_a_template_pick_becomes_its_first_branch():
    from engine.ai import text_items
    out = text_items.compile_template({"template": "$hero, {red|blue} cloak, {2$$ $$a|b|c}",
                                       "negative": "{lowres|blurry}"})
    assert out["payload"] == {"template_string": "$hero, red cloak, a",
                              "negative_template": "lowres"}
    assert sum("Assembler can't pick" in w for w in out["warnings"]) == 3
    with pytest.raises(ValueError, match="empty"):
        text_items.compile_template({"template": "{|}"})


def test_quality_and_negative_slots_are_not_picks():
    g = _graph([_slot("Quality", "qual", "masterpiece, best quality, highres", []),
                _slot("Hero", "hero", "heroes", []),
                _slot("Negative Prompt", "negative", "lowres, bad hands", [])],
               [], ["Quality", "Hero", "Negative Prompt"])
    plan = pack.compile_graph_plan(g)
    graph = plan["graph"]
    assert [s["var"] for s in graph["slots"]] == ["hero"]
    assert graph["fixed"] == [{"name": "Quality", "var": "qual",
                               "text": "masterpiece, best quality, highres", "negative": ""}]
    assert graph["template"]["negative"] == "lowres, bad hands"
    assert graph["template"]["order"] == ["qual", "hero"]
    assert plan["applied"] == [
        "Quality is fixed values: quality words are the same every run",
        "Negative Prompt is the negative prompt, not a pick: it went to the template's "
        "negative"]
    kinds = {i["name"]: i["kind"] for i in plan["items"]}
    assert kinds["Quality"] == "fixed_values" and "Negative Prompt" not in kinds
    # A quality slot with no words of its own gets the style's usual ones;
    # one that sits in a relation (the model meant a pick) is left alone.
    g = _graph([_slot("Quality", "quality", "quality words", []),
                _slot("Hero", "hero", "heroes", [])], [], ["Quality", "Hero"], style="sentences")
    assert pack.compile_graph_plan(g)["graph"]["fixed"][0]["text"] == "high quality, detailed"
    g = _graph([_slot("Quality", "quality", "quality words", []),
                _slot("Hero", "hero", "heroes", [{"name": "era", "values": ["old", "new"]}])],
               [_rel("boost", "Hero", "era", "old", "Quality", "", "", factor=2)],
               ["Quality", "Hero"])
    plan = pack.compile_graph_plan(g)
    assert [s["var"] for s in plan["graph"]["slots"]] == ["quality", "hero"]
    assert plan["graph"]["fixed"] == []


def test_a_preset_asked_for_its_own_negatives_carries_the_standing_one():
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Style", "Hero"],
               fixed=[{"name": "Style", "var": "style", "text": "anime screencap",
                       "negative": ""}])
    g["template"]["negative"] = "bad anatomy, lowres"
    plan = pack.compile_graph_plan(
        g, request="An anime style preset with quality tags and its own negatives.")
    assert plan["graph"]["fixed"][0]["negative"] == "bad anatomy, lowres"
    assert plan["graph"]["template"]["negative"] == ""
    assert "Style carries its own negative (it was the template's), as asked" in plan["applied"]
    # Without the ask, or when the preset already has one, nothing moves.
    plain = pack.compile_graph_plan(copy.deepcopy(g), request="anime heroes with a preset")
    assert plain["graph"]["template"]["negative"] == "bad anatomy, lowres"
    g["fixed"][0]["negative"] = "photo"
    own = pack.compile_graph_plan(g, request="a preset with its own negatives")
    assert own["graph"]["fixed"][0]["negative"] == "photo"
    assert own["graph"]["template"]["negative"] == "bad anatomy, lowres"


def test_the_verifier_sees_a_pick_behind_its_drawn_prefix():
    # A draw puts "@{id:warm} " in front of every Scarf option; the run's
    # value is the resolved text, so the match looks past the reference.
    g = _graph([_slot("Colours", "colour", "colours",
                      [{"name": "warmth", "values": ["warm", "cool"]}]),
                _slot("Season", "season", "the season",
                      [{"name": "season", "values": ["winter", "summer"]}]),
                _slot("Scarf", "scarf", "scarves",
                      [{"name": "weight", "values": ["thick", "thin"]}])],
               [_rel("draw", "Colours", "warmth", "warm", "Scarf"),
                _rel("exclude", "Season", "season", "summer", "Scarf", "weight", "thick")],
               ["Season", "Scarf"])
    plan = pack.compile_graph_plan(g)
    built = _build(plan, {"Colours": [("red", {"warmth": ["warm"]}),
                                      ("blue", {"warmth": ["cool"]})],
                          "Season": [("winter", {"season": ["winter"]}),
                                     ("summer", {"season": ["summer"]})],
                          "Scarf": [("wool scarf", {"weight": ["thick"]}),
                                    ("silk scarf", {"weight": ["thin"]})]})
    scarf = next(b for b in built.values() if b["payload"].get("options")
                 and "scarf" in b["payload"]["options"][0]["value"])
    assert scarf["payload"]["options"][0]["value"].startswith("@{")
    runs = [{"season": "winter", "season.season": "winter", "scarf": "red wool scarf"},
            {"season": "summer", "season.season": "summer", "scarf": "red silk scarf"}]
    rows = pg.verify_relations(plan, built, runs)
    row = next(r for r in rows if r["kind"] == "exclude")
    assert (row["seen"], row["broken"], row["holds"]) == (1, 0, True), row


def test_one_otherwise_per_variable_in_the_rule_and_the_check():
    g = _graph([_slot("Class", "class", "classes",
                      [{"name": "role", "values": ["caster", "martial", "rogue"]}])],
               [_rel("derive", "Class", "role", "caster", var="title", text="Archmage",
                     otherwise="Adventurer"),
                _rel("derive", "Class", "role", "martial", var="title", text="Knight",
                     otherwise="Wanderer")],
               ["Class"])
    plan = pack.compile_graph_plan(g)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "derivation")
    out = pg.wired_payload(plan, key, {})
    assert out["payload"]["rules"][0]["else"]["action"]["value"] == "Adventurer"
    assert out["warnings"] == ['$title has one "otherwise": kept "Adventurer", not "Wanderer"']
    built = _build(plan, {"Class": [("mage", {"role": ["caster"]}),
                                    ("thief", {"role": ["rogue"]})]})
    runs = [{"class": "thief", "class.role": "rogue", "title": "Adventurer"}]
    rows = pg.verify_relations(plan, built, runs)
    # Neither row fired; the else the rule carries is what both expect.
    assert all(r["broken"] == 0 for r in rows), rows


def test_a_repair_that_resolved_nothing_keeps_its_left_out_relations():
    g = _graph([_slot("Hero", "hero", "heroes", [{"name": "kind", "values": ["elf"]}]),
                _slot("Pet", "pet", "pets", [])],
               [_rel("exclude", "Hero", "kind", "elf", "Dragon")], ["Hero", "Pet"])
    first = pack.compile_graph(g)
    assert first["bad_refs"] and first["relations"] == []
    fixed = pack.with_refs(first, {"relations": [
        _rel("exclude", "Hero", "kind", "elf", "Castle")]})
    assert fixed["relations"] == [] and len(fixed["bad_refs"]) == 1
    assert pg._compiled(fixed)
    plan = pack.compile_graph_plan(fixed)
    # Both misses are listed (one repair call, no second ask).
    assert plan["bad_refs"] == []
    assert sorted(plan["graph"]["dropped"]) == sorted([*first["bad_refs"], *fixed["bad_refs"]])
    assert sum("Left out a rule" in w for w in plan["warnings"]) == 2
    # The model's shape and the plan's graph are still read as written.
    assert not pg._compiled(pg.graph_answer(plan))
    assert not pg._compiled(plan["graph"])


def test_the_anchor_follows_the_slots_the_code_takes_out():
    g = _graph([_slot("Quality", "quality", "masterpiece, best quality", []),
                _slot("Hero", "hero", "heroes", [])], [], ["Quality", "Hero"])
    plan = pack.compile_graph_plan(g)
    assert plan["graph"]["anchor"] == "hero"
    assert plan["anchor"] == "hero"


def test_a_graph_slot_lists_every_axis_value():
    values = [f"v{n}" for n in range(20)]
    g = _graph([_slot("Big", "big", "many", [{"name": "a", "values": values[:10]},
                                              {"name": "b", "values": values[10:]}]),
                _slot("Hero", "hero", "heroes", [])], [], ["Big", "Hero"])
    plan = pack.compile_graph_plan(g)
    assert next(i for i in plan["items"] if i["name"] == "Big")["tags"] == values


def test_a_recompile_keeps_the_plans_settings_and_decisions():
    g = _graph([_slot("Hero", "hero", "heroes", []),
                _slot("Pet", "pet", "pets", [])], [], ["Hero", "Pet"])
    plan = pack.compile_graph_plan(g, settings={"model": "family"},
                                   decisions=[{"question": "Q?", "answer": "A"}])
    assert plan["settings"]["model"] == "family" and plan["decisions"] == [
        {"question": "Q?", "answer": "A"}]
    # A route that sends the plan back without naming them again, and a
    # repair that compiles on the previous plan: both keep them.
    back = pack.compile_graph_plan(plan)
    assert back["settings"]["model"] == "family" and back["decisions"] == plan["decisions"]
    assert any(i["name"] == "Model quality" for i in back["items"])
    again = pack.compile_graph_plan(pg.graph_answer(plan), previous=plan)
    assert again["settings"]["model"] == "family" and again["decisions"] == plan["decisions"]


def test_one_writer_of_quality_with_the_per_family_rule():
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Quality", "Hero"],
               fixed=[{"name": "Quality", "var": "quality", "text": "masterpiece",
                       "negative": ""}])
    plan = pack.compile_graph_plan(g, settings={"model": "family"})
    assert plan["graph"]["fixed"] == []
    assert "Quality: the per-model-family rule writes $quality, so the fixed value went" \
        in plan["applied"]
    kinds = [(i["kind"], i["var"]) for i in plan["items"] if i["var"] == "quality"]
    assert kinds == [("derivation", "quality")]
    # A Quality slot the code turns into fixed values goes the same way.
    g = _graph([_slot("Quality", "quality", "masterpiece, best quality", []),
                _slot("Hero", "hero", "heroes", [])], [], ["Quality", "Hero"])
    plan = pack.compile_graph_plan(g, settings={"model": "family"})
    assert plan["graph"]["fixed"] == [] and plan["graph"]["anchor"] == "hero"
    # Without the setting the preset stands.
    assert pack.compile_graph_plan(g)["graph"]["fixed"][0]["var"] == "quality"


def test_a_removed_relation_stays_removed_however_the_model_spells_it():
    g = _graph([_slot("Season", "season", "the season",
                      [{"name": "season", "values": ["winter", "summer"]}]),
                _slot("Shoes", "shoes", "footwear",
                      [{"name": "season", "values": ["winter", "summer"]}])],
               [_rel("exclude", "Season", "season", "winter", "Shoes", "season", "summer")],
               ["Season", "Shoes"])
    plan = pack.compile_graph_plan(g)
    sig = pg.raw_rel_sig(pg.graph_answer(plan)["relations"][0])
    plan["locks"] = {"slots": [], "relations": [], "removed_relations": [sig], "template": []}
    answer = pg.graph_answer(plan)
    # The next answer writes it again, lower-cased and with the axis left
    # for the value to find: it stays out.
    answer["relations"] = [_rel("exclude", "season", "", "winter", "shoes", "", "summer")]
    again = pack.compile_graph_plan(answer, previous=plan)
    assert again["graph"]["relations"] == []
    assert pg._sig_like("exclude|Season|season|winter|Shoes|season|summer||",
                        "exclude|season||winter|shoes||summer||")
    assert not pg._sig_like("exclude|Season|season|winter|Shoes|season|summer||",
                            "exclude|Season|season|winter|Shoes|season|winter||")


def _wild(mid, name, var, options):
    return {"id": mid, "type": "wildcard", "name": name, "description": "",
            "payload": {"var_binding": var, "sub_categories": [], "options": [
                {"id": f"{mid[:4]}000{n}", "value": o, "weight": 1, "sub_categories": []}
                for n, o in enumerate(options)]}}


def test_reuse_swaps_a_fitting_slot_for_the_users_wildcard():
    lib = [_wild("aaaa0001", "Weather", "weather", ["rain", "sun"]),
           _wild("bbbb0001", "Hats", "hat", ["beret", "cap"]),
           _wild("cccc0001", "Mood", "mood", ["calm"])]
    g = _graph([_slot("Weather", "sky", "the weather", []),
                _slot("Hat", "hat", "hats", []),
                _slot("Mood", "mood", "moods", [{"name": "tone", "values": ["calm", "wild"]}]),
                _slot("Hero", "hero", "heroes", [])],
               [_rel("boost", "Mood", "tone", "calm", "Hero", "", "", factor=2)],
               ["Weather", "Hat", "Mood", "Hero"], anchor="sky")
    plan = pack.compile_graph_plan(g, library=lib, settings={"library": "reuse"})
    kinds = {i["name"]: (i["kind"], i["var"], i["library_id"]) for i in plan["items"]}
    # Matched by name (the variable follows the user's) and by variable.
    assert kinds["Weather"] == ("library", "weather", "aaaa0001")
    assert kinds["Hats"] == ("library", "hat", "bbbb0001")
    # A slot with axes or in a relation keeps its own tags: new.
    assert kinds["Mood"][0] == "wildcard" and kinds["Hero"][0] == "wildcard"
    assert plan["graph"]["template"]["order"] == ["weather", "hat", "mood", "hero"]
    assert plan["graph"]["anchor"] == "weather" and plan["anchor"] == "weather"
    assert "Weather: your wildcard Weather ($weather) is used as it is" in plan["applied"]
    assert "Hat: your wildcard Hats ($hat) is used as it is" in plan["applied"]
    key = next(i["key"] for i in plan["items"] if i["name"] == "Weather")
    assert pg.slot_for(plan, key) is None and not pg.is_wired(plan, key)
    out = pack.library_item(plan, key, lib)
    assert out["id"] == "aaaa0001" and out["warnings"] == ["Uses your wildcard Weather as it is"]
    # Sent back, the plan keeps the swap; without the setting nothing is swapped.
    again = pack.compile_graph_plan(plan, library=lib)
    assert {i["name"]: i["kind"] for i in again["items"]}["Weather"] == "library"
    plain = pack.compile_graph_plan(g, library=lib, settings={"library": "inspire"})
    assert all(i["kind"] != "library" for i in plain["items"])
    assert pg.library_slots(plan["graph"], lib, {"library": "reuse"}).keys() == {"weather",
                                                                                  "hat"}


def test_a_given_input_is_shown_and_a_lora_input_is_not():
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"],
               inputs=[{"var": "char_type", "about": "the creature the user gives",
                        "example": "a fox"},
                       {"var": "style_lora", "about": "a style LoRA", "example": ""}])
    plan = pack.compile_graph_plan(g)
    assert plan["graph"]["template"]["order"] == ["char_type", "hero"]
    assert "Added $char_type to the template so what the user gives shows" in plan["warnings"]
    key = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    assert "$char_type" in pg.wired_payload(plan, key, {})["payload"]["template_string"]


def test_an_internal_driver_is_not_asked_into_the_prompt():
    g = _graph([_slot("Season", "season", "the season",
                      [{"name": "season", "values": ["winter", "summer"]}], show="internal"),
                _slot("Outfit", "outfit", "outfits",
                      [{"name": "season", "values": ["winter", "summer"]}])],
               [_rel("agree", "Season", "season", "", "Outfit", "", "")], ["Outfit"])
    plan = pack.compile_graph_plan(g)
    built = _build(plan, {"Season": [("winter", {"season": ["winter"]}),
                                     ("summer", {"season": ["summer"]})],
                          "Outfit": [("parka", {"season": ["winter"]}),
                                     ("shorts", {"season": ["summer"]})]})
    problems: dict = {}
    notes = pack_check.unread_notes(plan, built, problems)
    assert notes == [] and problems == {}, (notes, problems)


def test_the_other_drafts_read_what_the_first_took_from_the_images():
    from engine.ai.pack import drafts
    assert drafts.images_seen({"from_images": ["a red cloak", "snow"]}) == (
        "The reference images were read with the first draft and aren't attached again; "
        "they showed: a red cloak; snow. Plan from that.")
    assert "aren't attached again" in drafts.images_seen({"from_images": []})


def test_a_slot_named_like_a_negative_goes_with_its_rules():
    # compile_plan drops any wildcard _NEGATIVEISH matches; the graph used
    # to keep "Bad Negatives" in the order (and a rule on it), so the
    # template read $bad_negatives, which nothing set (7 of 39 packs).
    g = _graph([_slot("Hero", "hero", "heroes", [{"name": "era", "values": ["old", "new"]}]),
                _slot("Bad Negatives", "bad_negatives", "lowres, bad hands",
                      [{"name": "kind", "values": ["anatomy", "style"]}])],
               [_rel("only", "Hero", "era", "old", "Bad Negatives", "kind", "anatomy")],
               ["Hero", "Bad Negatives"])
    plan = pack.compile_graph_plan(g)
    graph = plan["graph"]
    assert [s["var"] for s in graph["slots"]] == ["hero"]
    assert graph["relations"] == []
    assert graph["template"]["order"] == ["hero"]
    assert graph["template"]["negative"] == "lowres, bad hands"
    assert plan["applied"] == ["Bad Negatives is the negative prompt, not a pick: it went to "
                               "the template's negative (and its 1 rule went with it)"]
    assert "Bad Negatives" not in {i["name"] for i in plan["items"]}


def test_a_rule_that_writes_a_number_is_a_weight_on_the_options():
    # 9B, pack 7: "$hair_len_prob = 1.5 when Hair.length is long" for "long
    # styles more common", broken on every run. A number is a weight.
    g = _graph([_slot("Hair", "hair", "hairstyles",
                      [{"name": "length", "values": ["long", "short"]}])],
               [_rel("derive", "Hair", "length", "long", var="hair_len_prob", text="1.5"),
                _rel("derive", "Hair", "length", "short", var="hair_short", text="x0.5"),
                _rel("derive", "Hair", "length", "short", var="hair_same", text="1")],
               ["Hair"])
    plan = pack.compile_graph_plan(g)
    graph = plan["graph"]
    hair = graph["slots"][0]
    assert graph["relations"] == []
    assert hair["weights"] == {"long": 1.5, "short": 0.5}
    assert [i["kind"] for i in plan["items"]] == ["wildcard", "template"]
    assert ("Hair: long options weigh \u00d71.5 (the rule wrote a number, so it is a weight "
            "on the options, not text)") in plan["warnings"]
    out = pack.compile_slot(graph, hair, _answer([("braid", {"length": ["long"]}),
                                                   ("bob", {"length": ["short"]}),
                                                   ("ponytail", {"length": ["long"]})]))
    assert [(o["value"], o["weight"]) for o in out["payload"]["options"]] == [
        ("braid", 1.5), ("bob", 0.5), ("ponytail", 1.5)]
    # The weights ride the graph back from the editor; an unknown value or
    # a factor of 1 is dropped.
    raw = copy.deepcopy(graph)
    raw["slots"][0]["weights"] = {"long": 2, "curly": 3, "short": 1}
    again = pack.compile_graph_plan(raw)
    assert again["graph"]["slots"][0]["weights"] == {"long": 2.0}
    raw["slots"][0]["weights"] = {}
    assert "weights" not in pack.compile_graph_plan(raw)["graph"]["slots"][0]


def test_negative_named_presets_and_inputs_go_to_the_template_negative():
    # 9B, 2026-10-21 (9 packs): compile_plan drops a preset named neg /
    # default_neg, but the graph's order kept $neg, so the template read a
    # variable no run set. Inputs named like a negative likewise.
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["default_neg", "neg_prompt", "Hero"],
               fixed=[{"name": "Default Neg", "var": "default_neg",
                       "text": "lowres, bad hands", "negative": ""}],
               inputs=[{"var": "neg_prompt", "about": "extra negatives", "example": ""},
                       {"var": "subject", "about": "who it is", "example": "a knight"}])
    g["template"]["negative"] = "ugly"
    plan = pack.compile_graph_plan(g)
    graph = plan["graph"]
    assert graph["fixed"] == [] and [i["var"] for i in graph["inputs"]] == ["subject"]
    assert graph["template"]["order"] == ["subject", "hero"]
    assert graph["template"]["negative"] == "ugly, lowres, bad hands"
    assert plan["applied"] == [
        "Default Neg is the negative prompt, not a preset: its words went to the template's "
        "negative",
        "$neg_prompt is a negative, not an input: negatives are the template's"]
    assert {i["kind"] for i in plan["items"]} == {"wildcard", "template"}


def test_the_negative_drops_placeholders_and_an_assignment():
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"])
    g["template"]["negative"] = "$neg = ugly, {{fixed.default_neg}}, blurry, {{Hero}}"
    plan = pack.compile_graph_plan(g)
    assert plan["graph"]["template"]["negative"] == "ugly, blurry, $hero"
    assert any("written as an assignment" in w for w in plan["warnings"])
    assert any("Took {fixed.default_neg} out" in w for w in plan["warnings"])


def test_the_model_field_keeps_only_the_families_the_request_names():
    assert pg.request_families("a pack for Pony and Flux") == ["pony", "flux"]
    assert pg.request_families("cute cats") == []
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"], model="flux, sd3")
    # The planner's own two families on a request naming none: no rule.
    plan = pack.compile_graph_plan(copy.deepcopy(g), request="fantasy heroes")
    assert plan["graph"]["model"] == "Flux"
    assert plan["applied"] == ["Model: Flux (the planner wrote \"Flux, SD3\", but the request "
                               "names no second family, so there is no per-family quality rule)"]
    assert not any(i["name"] == "Model quality" for i in plan["items"])
    # Named by the request: kept. Without a request: left as written.
    asked = pack.compile_graph_plan(copy.deepcopy(g), request="a pack for flux and sd3")
    assert asked["graph"]["model"] == "Flux, SD3"
    assert any(i["name"] == "Model quality" for i in asked["items"])
    assert pack.compile_graph_plan(copy.deepcopy(g))["graph"]["model"] == "Flux, SD3"
    # One named of three written: the named one stays.
    g["model"] = "pony, flux, sd3"
    assert pack.compile_graph_plan(g, request="an sd3 pack")["graph"]["model"] == "SD3"


def test_the_quality_rule_gets_the_packs_words_as_its_otherwise():
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Quality", "Hero"],
               model="pony, flux",
               fixed=[{"name": "Quality", "var": "quality", "text": "masterpiece, 8k",
                       "negative": ""}])
    plan = pack.compile_graph_plan(g, request="heroes for pony and flux")
    assert plan["graph"]["quality_words"] == "masterpiece, 8k"
    assert pack.compile_graph_plan(copy.deepcopy(plan["graph"]))["graph"]["quality_words"] \
        == "masterpiece, 8k"
    q = next(i for i in plan["items"] if i["name"] == "Model quality")
    hero = next(i for i in plan["items"] if i["name"] == "Hero")
    built = {hero["key"]: {"id": hero["id"], "payload": pg.compile_slot(
        plan["graph"], plan["graph"]["slots"][0], _answer([("knight", {})]))["payload"]}}
    out = pack.compile_item(plan, q["key"], built, {"rules": [{
        "summary": "pony quality", "branches": [{
            "match": "all",
            "conditions": [{"var": "model_variant", "op": "equals", "value": "pony"}],
            "actions": [{"target_var": "quality", "mode": "replace", "value": "score_9"}]}],
        "else_actions": []}]})
    [rule] = out["payload"]["rules"]
    assert rule["else"]["action"] == {"target_var": "quality", "mode": "replace",
                                      "value": "masterpiece, 8k"}
    assert any("Added an otherwise" in w for w in out["warnings"])
    # Written with one: kept as the model wrote it.
    own = pack.compile_item(plan, q["key"], built, {"rules": [{
        "summary": "pony quality", "branches": [{
            "match": "all",
            "conditions": [{"var": "model_variant", "op": "equals", "value": "pony"}],
            "actions": [{"target_var": "quality", "mode": "replace", "value": "score_9"}]}],
        "else_actions": [{"target_var": "quality", "mode": "replace", "value": "best"}]}]})
    assert own["payload"]["rules"][0]["else"]["action"]["value"] == "best"


def test_rows_on_a_second_axis_write_a_rule_of_their_own():
    # 9B, 2026-10-21 (pack 6): eight rows wrote $habitat, four on each of
    # two axes, in one if/elif, so the first axis always won.
    g = _graph([_slot("Animal", "animal", "animals",
                      [{"name": "temp", "values": ["hot", "cold"]},
                       {"name": "size", "values": ["big", "small"]}])],
               [_rel("derive", "Animal", "temp", "hot", var="habitat", text="sunny plains"),
                _rel("derive", "Animal", "temp", "cold", var="habitat", text="icy tundra"),
                _rel("derive", "Animal", "size", "big", var="habitat", text="wide open"),
                _rel("derive", "Animal", "size", "small", var="habitat", text="dense cover")],
               ["Animal", "habitat"])
    plan = pack.compile_graph_plan(g)
    built = _build(plan, {"Animal": [("camel", {"temp": ["hot"], "size": ["big"]}),
                                     ("vole", {"temp": ["cold"], "size": ["small"]})]})
    rule = next(i for i in plan["items"] if i["kind"] == "derivation")
    rules = built[rule["key"]]["payload"]["rules"]
    assert [r["id"] for r in rules] == ["rule0001", "rule0002"]
    assert [b["action"]["mode"] for b in rules[0]["branches"]] == ["replace", "replace"]
    assert [b["action"]["mode"] for b in rules[1]["branches"]] == ["append", "append"]
    assert rules[1]["branches"][0]["condition"]["var"] == "animal.size"
    out = pg.wired_payload(plan, rule["key"], built)
    assert out["warnings"] == ["$habitat is also written from Animal.size: those rows add to "
                               "it (one rule per axis, so both fire)"]
    report = pack.check_pack(plan, built, seeds=20)
    assert all(r["holds"] for r in report["relations"]), report["relations"]


def test_a_rule_keyed_on_a_multi_pick_slot_goes():
    # The engine sets $animal.biome for one pick only, so a derive on a
    # 1-3 pick never fired (9B, 2026-10-21, pack 6).
    g = _graph([_slot("Animal", "animal", "animals",
                      [{"name": "biome", "values": ["forest", "desert"]}], pick="1-3"),
                _slot("Sky", "sky", "skies", [{"name": "time", "values": ["day", "night"]}])],
               [_rel("derive", "Animal", "biome", "forest", var="animal_biome", text="woods"),
                _rel("derive", "Sky", "time", "night", var="light", text="moonlit"),
                _rel("only", "Animal", "biome", "desert", "Sky", "time", "day")],
               ["Animal", "animal_biome", "Sky", "light"])
    plan = pack.compile_graph_plan(g)
    graph = plan["graph"]
    assert [r["kind"] for r in graph["relations"]] == ["derive", "only"]
    assert graph["template"]["order"] == ["animal", "sky", "light"]
    assert plan["applied"] == ["Animal picks 1-3, so $animal_biome can't follow one "
                               "Animal.biome value: that rule went"]
    # The request's own count does the same.
    g2 = _graph([_slot("Animal", "animal", "animals",
                       [{"name": "biome", "values": ["forest", "desert"]}])],
                [_rel("derive", "Animal", "biome", "forest", var="animal_biome", text="woods")],
                ["Animal", "animal_biome"])
    plan = pack.compile_graph_plan(g2, request="2 to 3 animals in their biome")
    assert plan["graph"]["relations"] == [] and plan["graph"]["slots"][0]["pick"] == "2-3"


def test_the_model_field_names_families_never_a_file_name():
    """A LoRA or checkpoint file name, or a word the field length cut off,
    never shows as the plan's model (Dumi 2026-10-21: "for
    illustriousXLv01_stabilizer_v1.185c, ani")."""
    g = _graph([_slot("Hero", "hero", "heroes", [])], [], ["Hero"],
               model="illustriousXLv01_stabilizer_v1.185c, ani")
    assert pack.compile_graph_plan(g)["graph"]["model"] == "Illustrious"
    g["model"] = "anime"
    assert pack.compile_graph_plan(g)["graph"]["model"] == ""
