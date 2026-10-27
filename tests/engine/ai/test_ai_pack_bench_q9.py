"""Pack builder fixes from the 9B bench review (critiques #31-#35, #41,
#42; 2026-10-27): glued "add to" words, rules that held by tags while the
prompt broke them, a second pick written by a rule, a template that lost
its picks."""
from __future__ import annotations

import copy

from engine.ai import pack
from engine.ai.pack import check as pack_check
from engine.ai.pack import graph as pg
from tests.engine.ai.test_ai_pack_graph import GRAPH, _build, _plan


def test_append_rule_gets_its_comma():
    """#31: "add to $x" glued its words on ("war hammerblade")."""
    g = copy.deepcopy(GRAPH)
    for r in g["relations"]:
        if r["kind"] == "append":
            r["text"] = "scarf"
    plan = pg.compile_graph_plan(g)
    built = _build(plan)
    rule = next(built[i["key"]]["payload"] for i in plan["items"] if i["name"] == "Outfit rule")
    assert rule["rules"][0]["branches"][0]["action"] == {
        "target_var": "outfit", "mode": "append", "value": ", scarf"}


def test_join_piece():
    from engine.ai.derivation import join_piece
    assert join_piece("append", "blade") == ", blade"
    assert join_piece("append", ", blade") == ", blade"
    assert join_piece("append", " blade") == " blade"
    assert join_piece("prepend", "old") == "old, "
    assert join_piece("replace", "blade") == "blade"


def test_exclude_breaks_when_another_item_prints_the_banned_option():
    """#32: the rule held by tags (the Weapon pick was a staff) while a rule
    wrote "musket" into the prompt anyway."""
    plan = _plan()
    built = _build(plan)
    ctx = {"race": "elf", "class": "mage", "class.role": "caster", "weapon": "oak staff",
           "season": "winter", "season.season": "winter", "outfit": "wool coat, musket",
           "title": "Archmage"}
    rels = pg.verify_relations(plan, built, [ctx], ["elf, mage, oak staff, wool coat, musket"])
    ex = next(r for r in rels if r["kind"] == "exclude")
    assert ex["broken"] == 1 and not ex["holds"]
    assert ex["shown"] == ["musket"]
    # The only row: a caster's prompt showed a blade from another item.
    ctx2 = {**ctx, "outfit": "wool coat, longsword"}
    rels = pg.verify_relations(plan, built, [ctx2],
                               ["elf, mage, oak staff, wool coat, longsword"])
    only = next(r for r in rels if r["kind"] == "only")
    assert only["broken"] == 1 and only["shown"] == ["longsword"]


def test_banned_texts_skip_what_an_allowed_option_says():
    payload = {"options": [{"value": "leather boots", "sub_categories": ["winter"]},
                           {"value": "sandals", "sub_categories": ["summer"]},
                           {"value": "sandals, socks", "sub_categories": ["winter"]}]}
    rel = {"kind": "exclude", "to": {"value": "summer"}}
    assert pg._banned_texts(rel, payload, set(), set()) == []  # sandals is fine in winter
    payload["options"].pop()
    assert pg._banned_texts(rel, payload, set(), set()) == ["sandals"]


def test_double_pick_from_a_rule_is_a_problem():
    """#32: two pairs of shoes in one prompt, the second written by a rule."""
    plan = _plan()
    built = _build(plan)
    key = next(i["key"] for i in plan["items"] if i["name"] == "Outfit rule")
    runs = [{"race": "elf", "class": "mage", "weapon": "oak staff", "season": "winter",
             "outfit": "wool coat, dagger", "title": "Archmage", "quality": "best"}] * 6
    out = pack_check._double_picks(plan, built, runs, "$race, $weapon, $outfit", "")
    assert key in out and "second Weapon pick" in out[key] and '"dagger"' in out[key]
    clean = [{**r, "outfit": "wool coat"} for r in runs]
    assert pack_check._double_picks(plan, built, clean, "$race, $weapon, $outfit", "") == {}


def test_internal_slot_nothing_reads_shows():
    """#33: a slot the planner made internal that no rule reads did nothing;
    a template left with no pick read only its lead."""
    g = copy.deepcopy(GRAPH)
    for s in g["slots"]:
        if s["name"] == "Class":
            s["show"] = "internal"
    g["relations"] = [r for r in g["relations"] if "Class" not in (r["from_slot"], r["to_slot"])]
    plan = pg.compile_graph_plan(g)
    assert pg.slot_by_var(plan["graph"], "class")["show"] == "prompt"
    assert "class" in plan["graph"]["template"]["order"]
    assert any("Class shows in the prompt" in a for a in plan["applied"])


def test_template_that_lost_every_pick_reads_them_again():
    g = pg.compile_graph(GRAPH)
    g["template"]["order"] = []
    lines = pg.show_unread(g)
    assert {"race", "class", "weapon", "outfit"} <= set(g["template"]["order"])
    assert lines


def test_wired_template_fix_is_marked():
    plan = _plan()
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert pg.is_wired(plan, tpl["key"])


def test_recompile_keeps_the_items():
    """A plan sent back for a build compiles to the same items (the P11
    "no such item in the plan" error on a constraint)."""
    plan = pg.compile_graph_plan(copy.deepcopy(GRAPH), request="fantasy heroes")
    again = pg.compile_graph_plan(copy.deepcopy(plan), previous=copy.deepcopy(plan))
    assert [(i["key"], i["name"]) for i in again["items"]] == [
        (i["key"], i["name"]) for i in plan["items"]]
    assert pack.is_wired(again, next(i["key"] for i in again["items"]
                                     if i["kind"] == "constraint"))


def test_negatives_tidied():
    """#35: a negative never names the option's own words, another option
    of the slot, an id or a repeat."""
    from engine.ai.pack.neg_tidy import dedupe, fit_ratings, tidy_negative
    neg, gone = tidy_negative("sneakers, dwarf, pose_1, blurry, blurry", "white sneakers",
                              ["white sneakers", "dwarf"])
    assert neg == "blurry"
    assert set(gone) == {"sneakers", "dwarf", "pose_1", "blurry"}
    assert dedupe("mutation, bad hands, mutation") == "mutation, bad hands"
    assert fit_ratings("rating explicit, rating_safe, nude", "nsfw") == (
        "rating_explicit, nude", 2)
    assert fit_ratings("rating_safe, hat", "safe") == ("rating_safe, hat", 0)


def test_standing_negative_never_bans_a_pick():
    g = copy.deepcopy(GRAPH)
    g["template"]["negative"] = "lowres, wool coat, lowres, score_4"
    plan = pg.compile_graph_plan(g)
    built = _build(plan)
    tpl = next(built[i["key"]]["payload"] for i in plan["items"] if i["kind"] == "template")
    assert tpl["negative_template"] == "lowres"


def test_negative_only_fixed_value_is_kept():
    from engine.ai import text_items
    out = text_items.compile_fixed({"values": [
        {"name": "anatomy", "value": "", "negative": "bad anatomy, extra fingers"}]})
    assert out["payload"]["values"][0]["negative"] == "bad anatomy, extra fingers"


def test_library_row_named_like_a_slot_must_fit():
    """#41: the user's fantasy Race was reused in a Star Wars pack."""
    row = {"id": "b0000001", "type": "wildcard", "name": "Race", "description": "",
           "payload": {"var_binding": "race", "options": [
               {"id": "o1", "value": "elf", "weight": 1}, {"id": "o2", "value": "dwarf",
                                                           "weight": 1}]}}
    g = pg.compile_graph(copy.deepcopy(GRAPH))
    for s in g["slots"]:
        if s["name"] == "Race":
            s["axes"], s["what"] = [], "Star Wars species like twi'lek and wookiee"
    g["relations"] = [r for r in g["relations"] if "Race" not in (
        r["from"]["slot"], (r.get("to") or {}).get("slot"))]
    assert pg.library_slots(g, [row], {"library": "reuse"}) == {}
    pg.slot_by_var(g, "race")["what"] = "fantasy races: elf, dwarf"
    assert "race" in pg.library_slots(g, [row], {"library": "reuse"})


def test_inventory_lists_only_related_rows():
    from engine.ai.pack.prompts import inventory
    rows = [{"type": "wildcard", "name": "Race", "payload": {"var_binding": "race", "options": [
        {"value": "elf"}, {"value": "dwarf"}]}},
        {"type": "wildcard", "name": "Shoes", "payload": {"var_binding": "shoes", "options": [
            {"value": "sneakers"}]}}]
    assert [r["name"] for r in inventory(rows, "everyday outfits with sneakers")] == ["Shoes"]
    assert len(inventory(rows, "a pack from my wildcards")) == 2


def test_couple_asks_who():
    g = pg.compile_graph(copy.deepcopy(GRAPH))
    qs = pg.code_questions(g, "a couples pack, tender and rough")
    assert any(q["question"] == pg.PAIR_QUESTION for q in qs)
    assert not any(q["question"] == pg.PAIR_QUESTION
                   for q in pg.code_questions(g, "a couple, a man and a woman"))


def test_plan_words_leave_the_template_text():
    g = copy.deepcopy(GRAPH)
    g["template"]["lead"] = "1girl, solo, character, look, pose, no elf, no beast"
    out = pg.compile_graph(g)
    assert out["template"]["lead"] == "1girl, solo"


def test_quality_rule_keeps_only_the_packs_families():
    plan = pack.compile_graph_plan({**copy.deepcopy(GRAPH), "model": "Pony, Flux"})
    q = next(i for i in plan["items"] if i["var"] == "quality")
    assert "illustrious" not in q["about"] and "flux →" in q["about"]


def test_edit_against_the_ask_and_dropped_words():
    """#42: "more sporty" became an exclude on sporty; "drop fur" came back."""
    from engine.ai.pack import graph_change as gc
    rels = [{"kind": "exclude", "from_slot": "Season", "from_value": "winter",
             "to_slot": "Outfit", "to_value": "sporty", "words": []},
            {"kind": "boost", "from_slot": "Season", "from_value": "summer",
             "to_slot": "Outfit", "to_value": "linen", "words": []}]
    kept, said = gc.against_ask("make it more sporty", rels, set())
    assert [r["kind"] for r in kept] == ["boost"] and said
    kept, said = gc.against_ask("drop the linen", rels, set())
    assert [r["kind"] for r in kept] == ["exclude"]
    slot = {"name": "Outfit", "what": "winter outfits"}
    assert gc.land_drops(slot, "rain jacket for autumn, drop fur")
    assert pg.slot_never(slot) == ["fur"]
    assert not gc.land_drops({"name": "Shoes", "what": ""}, "drop sandals in winter")
    g = pg.compile_graph(copy.deepcopy(GRAPH))
    outfit = pg.slot_by_var(g, "outfit")
    outfit["what"] = "outfits. Never: fur."
    out = pg.compile_slot(g, outfit, {"options": [
        {"text": "fur coat", "weight": 1, "negative": "", "tags": {"season": ["winter"]}},
        {"text": "rain jacket", "weight": 1, "negative": "", "tags": {"season": ["winter"]}},
        {"text": "linen dress", "weight": 1, "negative": "", "tags": {"season": ["summer"]}}]})
    texts = [o["value"] for o in out["payload"]["options"] if not o.get("is_null")]
    assert "fur coat" not in texts and "rain jacket" in texts


def test_cut_off_notes_exist():
    assert "shorter" in pack.ITEM_CUT_OFF_NOTE and "shorter" in pack.REVIEW_CUT_OFF_NOTE


def test_loop_and_model_vars_stay_out_of_the_template_text():
    g = copy.deepcopy(GRAPH)
    g["template"]["lead"] = "$model_family, $iteration, 1girl"
    assert pg.compile_graph(g)["template"]["lead"] == "1girl"
