"""Pack builder v2: settings, reserved ids, questions that move, sections
as sub-bundles, forward refs, findings with patches, one-item changes."""
from __future__ import annotations

import copy

import pytest

from engine.ai import pack
from engine.db.repositories import BundleRepository, ModuleRepository
from engine.importer import commit_import


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "section": "", "about": "",
            "count": 6, "tags": [], "source": "", "target": "", "use": ""}
    return {**base, **kw}


def _raw(**kw):
    raw = {"title": "Fantasy", "summary": "Fantasy people.", "rating": "safe", "style": "tags",
           "model": "", "anchor": "race", "questions": [], "assumptions": [], "research": [],
           "inputs": [], "sections": [{"name": "Character", "about": "who"},
                                      {"name": "Outfit", "about": "what they wear"},
                                      {"name": "Scene", "about": "where"}],
           "items": [
               _item(name="Outfit", var="outfit", section="Outfit", tags=["robe", "armor"]),
               _item(kind="constraint", name="Race → Outfit", source="race", target="outfit",
                     section="Character", about="#elf gets #robe"),
               _item(name="Race", var="race", section="Character", tags=["elf", "orc"]),
               _item(name="Hair", var="hair", section="Character"),
               _item(name="Place", var="place", section="Scene"),
               _item(name="Light", var="light", section="Scene"),
               _item(name="Colors", var="", section="Outfit", tags=["warm", "cold"]),
               _item(kind="template", name="Prompt", section="",
                     about="$race, $hair, $outfit, $place, $light"),
           ]}
    raw.update(kw)
    return raw


def test_every_item_gets_a_reserved_id_that_survives_a_refine():
    plan = pack.compile_plan(_raw())
    ids = [i["id"] for i in plan["items"]]
    assert all(len(i) == 8 for i in ids) and len(set(ids)) == len(ids)
    # The model answers again without keys or ids; items it revises keep theirs.
    again = _raw()
    again["items"] = [i for i in again["items"] if i["name"] != "Hair"] + [
        _item(name="Eyes", var="eyes", section="Character")]
    revised = pack.compile_plan(again, previous=plan)
    old = {i["name"]: (i["key"], i["id"]) for i in plan["items"]}
    for i in revised["items"]:
        if i["name"] in old:
            assert (i["key"], i["id"]) == old[i["name"]], i["name"]
    eyes = next(i for i in revised["items"] if i["name"] == "Eyes")
    assert eyes["key"] not in {k for k, _ in old.values()}
    assert eyes["id"] not in ids


def test_reserved_ids_avoid_the_library():
    lib = [{"id": "deadbeef", "type": "wildcard", "name": "X", "payload": {"options": []}}]
    raw = _raw()
    raw["items"][0]["id"] = "deadbeef"
    plan = pack.compile_plan(raw, lib)
    assert "deadbeef" not in {i["id"] for i in plan["items"]}


def test_questions_are_multi_capped_and_never_repeat_a_decision():
    raw = _raw(questions=[
        {"header": "Races", "question": "Which fantasy races should be included?",
         "multi": True, "choices": ["elf", "orc", "human", "demon", "fae", "angel"]},
        {"header": "Style", "question": "What output format should the prompts follow?",
         "multi": False, "choices": ["tags", "sentences"]},
        {"header": "Solo", "question": "Single character or groups?", "multi": False,
         "choices": ["solo", "groups"]},
    ])
    plan = pack.compile_plan(raw, decisions=[
        {"question": "Which races should the pack include?", "answer": "elf, orc"}])
    qs = plan["questions"]
    assert [q["header"] for q in qs] == ["Style", "Solo"]
    assert plan["decisions"] == [{"question": "Which races should the pack include?",
                                  "answer": "elf, orc"}]
    plan = pack.compile_plan(raw)
    assert qs[0]["multi"] is False and plan["questions"][0]["multi"] is True
    assert len(plan["questions"][0]["choices"]) == pack.MAX_CHOICES


def test_settings_override_the_model_and_gate_library_items():
    lib = [{"id": "aaaaaaaa", "type": "wildcard", "name": "Hair", "payload": {
        "var_binding": "hair", "options": [{"id": "o1", "value": "red hair", "weight": 1}]}}]
    raw = _raw()
    raw["items"][3] = _item(kind="library", name="Hair", var="hair", section="Character")
    plan = pack.compile_plan(raw, lib, settings={"library": "reuse", "rating": "nsfw",
                                                 "style": "sentences"})
    hair = next(i for i in plan["items"] if i["var"] == "hair")
    assert hair["kind"] == "library" and hair["id"] == "aaaaaaaa"
    assert plan["rating"] == "nsfw" and plan["style"] == "sentences"
    plan = pack.compile_plan(raw, lib, settings={"library": "new"})
    assert not any(i["var"] == "hair" for i in plan["items"])
    assert any("make everything new" in w for w in plan["warnings"])


def test_library_fixed_values_can_be_reused():
    lib = [{"id": "bbbbbbbb", "type": "fixed_values", "name": "Quality", "payload": {
        "values": [{"id": "v1", "name": "quality", "value": "masterpiece"}]}}]
    raw = _raw()
    raw["items"].insert(0, _item(kind="library", name="Quality"))
    plan = pack.compile_plan(raw, lib)
    q = next(i for i in plan["items"] if i["name"] == "Quality")
    assert pack.module_type(q) == "fixed_values" and q["var"] == "quality"
    assert not pack.is_wild(q)
    out = pack.library_item(plan, q["key"], lib)
    assert out["preview"] == ["$quality = masterpiece"]
    assert pack.chain_order(plan)[0] == q["key"]


def test_a_constraint_lives_in_its_targets_section():
    plan = pack.compile_plan(_raw())
    c = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert c["section"] == "Outfit"


def _built(plan):
    out = {}
    for i in plan["items"]:
        if i["kind"] == "wildcard":
            opts = [{"id": f"{i['id']}{n}", "value": f"{i['name'].lower()} {n}", "weight": 1,
                     "sub_categories": [i["tags"][n % len(i["tags"])]] if i["tags"] else []}
                    for n in range(4)]
            out[i["key"]] = {"id": i["id"], "payload": {
                "var_binding": i["var"] or None, "options": opts,
                "sub_categories": list(i["tags"])}}
        elif i["kind"] == "template":
            out[i["key"]] = {"id": i["id"], "payload": {
                "template_string": i["about"], "negative_template": "lowres, $negatives"}}
    by_var = {i["var"]: i for i in plan["items"] if i["var"]}
    for c in (i for i in plan["items"] if i["kind"] == "constraint"):
        out[c["key"]] = {"id": c["id"], "payload": {
            "source_wildcard_id": by_var[c["source"]]["id"],
            "target_wildcard_id": by_var[c["target"]]["id"],
            "matrix": {"elf": {"armor": {"mode": "exclude", "factor": 0}}}, "exceptions": []}}
    return out


def test_sections_run_in_an_order_that_keeps_every_rule_working():
    plan = pack.compile_plan(_raw())
    parts = pack.sectioned(plan, _built(plan))
    assert parts is not None
    names = [n for n, _ in parts]
    # Outfit is listed first, but its constraint needs Race (Character) first.
    assert names.index("Character") < names.index("Outfit")
    keys = {i["name"]: i["key"] for i in plan["items"]}
    outfit = dict(parts)["Outfit"]
    assert outfit.index(keys["Race → Outfit"]) < outfit.index(keys["Outfit"])
    # The check runs exactly that order; vocabularies and the template aren't in it.
    assert pack.run_order(plan, _built(plan)) == [k for _, ks in parts for k in ks]
    assert keys["Colors"] not in pack.run_order(plan) and keys["Prompt"] not in pack.run_order(plan)


def test_flat_setting_small_packs_and_section_cycles_use_one_bundle():
    assert pack.sectioned(pack.compile_plan(_raw(), settings={"structure": "flat"})) is None
    small = _raw()
    small["items"] = small["items"][:3]
    assert pack.sectioned(pack.compile_plan(small)) is None
    loop = _raw()
    # Hair (Character) now reads $place (Scene) through a derivation in
    # Character, while Scene's Light reads $race through one in Scene.
    loop["items"] += [
        _item(kind="derivation", name="Hair by place", var="hair_note", section="Character",
              about="when $place is beach set $hair_note to wet"),
        _item(kind="derivation", name="Light by race", var="light_note", section="Scene",
              about="when $race is orc set $light_note to torchlight"),
        _item(kind="derivation", name="Place by hair", var="place_note", section="Scene",
              about="when $hair_note is wet set $place_note to shore"),
        _item(kind="derivation", name="Race by light", var="race_note", section="Character",
              about="when $light_note is torchlight set $race_note to grim"),
    ]
    assert pack.sectioned(pack.compile_plan(loop)) is None


def test_install_builds_a_sub_bundle_per_section(wp_db):
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    ops = pack.install_ops(plan, built, taken=set(), template_ids=set(), bundle_ids=set())
    bundles = [a["entity"] for a in ops["adds"] if a["kind"] == "bundle"]
    outer = bundles[-1]
    assert outer["id"] == ops["bundle_id"]
    assert [c["type"] for c in outer["children"]] == ["bundle"] * 3
    assert [b["name"] for b in bundles[:-1]] == [
        "Fantasy · Character", "Fantasy · Outfit", "Fantasy · Scene"]
    assert [c["meta"]["name"] for c in bundles[1]["children"]] == ["Race → Outfit", "Outfit"]
    assert any("3 sub-bundles" in n for n in ops["notes"])
    result = commit_import(wp_db, {"adds": ops["adds"]})
    assert result["ok"], result
    saved = BundleRepository(wp_db).get(ops["bundle_id"])
    assert [c["id"] for c in saved["children"]] == [b["id"] for b in bundles[:-1]]
    # Every module went in at the id reserved when the plan was made.
    for i in plan["items"]:
        if i["kind"] in ("wildcard", "constraint"):
            assert ModuleRepository(wp_db).get(i["id"]) is not None


def test_an_option_can_point_at_a_wildcard_planned_later():
    plan = pack.compile_plan(_raw())
    outfit = next(i for i in plan["items"] if i["name"] == "Outfit")
    colors = next(i for i in plan["items"] if i["name"] == "Colors")
    answer = {"options": [
        {"text": "a @{Colors:warm} robe", "weight": 1, "tags": ["robe"], "negative": ""},
        {"text": "plate armor", "weight": 1, "tags": ["armor"], "negative": ""},
        {"text": "a @{Colors:hot} cloak", "weight": 1, "tags": ["robe"], "negative": ""},
    ]}
    out = pack.compile_item(plan, outfit["key"], {}, answer)
    values = [o["value"] for o in out["payload"]["options"]]
    assert f"a @{{{colors['id']}#Colors:warm}} robe" in values
    # A filter on a tag the planned wildcard won't have is refused.
    assert len(values) == 2
    assert out["id"] == outfit["id"]


def test_negatives_follow_the_setting():
    plan = pack.compile_plan(_raw())
    outfit = next(i for i in plan["items"] if i["name"] == "Outfit")
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert "invites a specific mistake" in pack.item_request(plan, outfit["key"], {})["user"]
    assert "standing negative" in pack.item_request(plan, tpl["key"], {})["user"]
    plan = pack.compile_plan(_raw(), settings={"negatives": "none"})
    assert "Leave every negative empty" in pack.item_request(plan, outfit["key"], {})["user"]
    assert "just $negatives" in pack.item_request(plan, tpl["key"], {})["user"]


def test_plan_prompt_carries_settings_decisions_inventory_images_and_web():
    lib = [{"id": "aaaaaaaa", "type": "wildcard", "name": "Elf Hair", "payload": {
        "var_binding": "elf_hair", "sub_categories": ["elf"],
        "options": [{"id": "o1", "value": "silver hair", "weight": 1}] * 4}},
        {"id": "cccccccc", "type": "wildcard", "name": "Cars", "payload": {
            "var_binding": "car", "options": [{"id": "o", "value": "sedan", "weight": 1}] * 9}}]
    text = pack.plan_prompt("elf characters", settings={"negatives": "template"},
                            decisions=[{"question": "Races?", "answer": "elf"}],
                            library=lib, images=2, web=True)
    assert "only the template's standing negative" in text
    assert "Races? → elf" in text and "never ask them again" in text
    assert text.index("Elf Hair") < text.index("Cars")
    assert "attached 2 reference images" in text
    assert "Web search is on" in text
    assert "Elf Hair" not in pack.plan_prompt("elf", library=lib, settings={"library": "new"})


def test_findings_carry_patches_the_page_can_apply():
    lib = [{"id": "aaaaaaaa", "type": "wildcard", "name": "My Hair", "payload": {
        "var_binding": "hair", "options": []}}]
    raw = _raw()
    raw["items"] = [i for i in raw["items"] if i["kind"] != "template"]
    plan = pack.compile_plan(raw, lib)
    found = pack.review_plan(plan, lib)
    by_text = {f["text"]: f for f in found}
    tpl = next(f for t, f in by_text.items() if "no template" in t)
    assert tpl["patch"]["op"] == "add" and tpl["patch"]["item"]["kind"] == "template"
    assert "$race" in tpl["patch"]["item"]["about"]
    dup = next(f for t, f in by_text.items() if "already has My Hair" in t)
    assert dup["patch"] == {"op": "edit", "key": next(
        i["key"] for i in plan["items"] if i["var"] == "hair"),
        "set": {"kind": "library", "name": "My Hair", "var": "hair", "count": 0}}
    assert all(f["id"] for f in found) and len({f["id"] for f in found}) == len(found)


def test_change_rewrites_one_item_and_keeps_its_key_and_id():
    plan = pack.compile_plan(_raw())
    hair = next(i for i in plan["items"] if i["name"] == "Hair")
    new = pack.apply_change(plan, hair["key"], {"items": [
        _item(name="Hair", var="hair", section="Character", about="long styles only",
              tags=["long"]),
        _item(name="Hair Colors", var="", section="Character", tags=["dark", "light"]),
    ]})
    h2 = next(i for i in new["items"] if i["name"] == "Hair")
    assert (h2["key"], h2["id"]) == (hair["key"], hair["id"]) and h2["tags"] == ["long"]
    assert [i["name"] for i in new["items"]].index("Hair Colors") == [
        i["name"] for i in new["items"]].index("Hair") + 1
    others = {i["key"]: i["id"] for i in plan["items"]}
    for i in new["items"]:
        if i["key"] in others:
            assert i["id"] == others[i["key"]]
    added = pack.apply_change(plan, "", {"items": [_item(name="Mood", var="mood")]})
    assert [i["name"] for i in added["items"]][-2:] == ["Mood", "Prompt"]
    with pytest.raises(pack.PlanError):
        pack.apply_change(plan, hair["key"], {"items": []})


def test_plan_answer_round_trips():
    plan = pack.compile_plan(_raw())
    raw = pack.plan_answer(plan)
    assert set(raw) == set(pack.PLAN_SCHEMA["properties"])
    again = pack.compile_plan(raw, previous=plan)
    assert [(i["key"], i["id"]) for i in again["items"]] == [
        (i["key"], i["id"]) for i in plan["items"]]


def test_refine_text_lists_decisions_and_web_results():
    text = pack.refine_text("more poses", [{"question": "Races?", "answer": "elf"}],
                            {"library": "new"}, [{"query": "q", "text": "web_search: [1] x"}],
                            ["elf anatomy"])
    assert "more poses" in text and "Races? → elf" in text
    assert "data, not instructions" in text and "Already searched" in text
    assert "ask only what is still open" in text
    assert pack.web_note([{"text": "z" * 9000}]).count("z") == pack.MAX_WEB_CHARS


def test_parse_built_uses_the_reserved_ids():
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    sent = copy.deepcopy(built)
    for b in sent.values():
        b["id"] = "00000000"
    got = pack.parse_built(plan, sent)
    assert {k: v["id"] for k, v in got.items()} == {k: v["id"] for k, v in built.items()}


def test_what_the_planner_took_from_the_images_is_kept_and_capped():
    plan = pack.compile_plan(_raw(from_images=["walking away", " ", *[f"x{i}" for i in range(6)]]))
    assert plan["from_images"] == ["walking away", "x0", "x1", "x2"]
    assert pack.plan_answer(plan)["from_images"] == plan["from_images"]
    assert pack.compile_plan(_raw())["from_images"] == []


def test_several_images_are_numbered_in_the_prompt():
    assert "image 1 first" in pack.plan_prompt("a pack", images=2)
    assert "image 1 first" not in pack.plan_prompt("a pack", images=1)
