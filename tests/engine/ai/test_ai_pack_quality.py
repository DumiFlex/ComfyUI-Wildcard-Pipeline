"""Pack builder quality: presets that copy other items' variables, twin
variables, and runtime warnings that land on their item."""
from __future__ import annotations

import pytest

from engine.ai import pack
from tests.engine.ai.test_ai_pack_v2 import _built, _item, _raw


def _with_preset(about="$style: anime, $hair: long hair"):
    raw = _raw()
    raw["items"].insert(0, _item(kind="fixed_values", name="Style Preset", var="style",
                                 section="Character", about=about))
    return pack.compile_plan(raw)


def test_review_flags_a_preset_that_sets_what_a_wildcard_sets():
    found = [f for f in pack.review_plan(_with_preset()) if f["level"] == "fix"]
    assert any("Style Preset also sets $hair, which Hair already set" in f["text"]
               for f in found)
    assert not any("Style Preset" in f["text"]
                   for f in pack.review_plan(_with_preset("$style: anime")))


def test_a_preset_is_told_and_kept_off_other_items_variables():
    plan = _with_preset()
    key = next(i["key"] for i in plan["items"] if i["name"] == "Style Preset")
    req = pack.item_request(plan, key, {})
    assert "Its main value is $style" in req["user"]
    assert "$hair (Hair)" in req["user"] and "don't set them here" in req["user"]
    out = pack.compile_item(plan, key, {}, {"values": [
        {"name": "style", "value": "anime", "negative": ""},
        {"name": "hair", "value": "long hair", "negative": ""}]})
    assert [v["name"] for v in out["payload"]["values"]] == ["style"]
    assert "Left out $hair: Hair sets it" in out["warnings"]
    assert all("$hair" not in p for p in out["preview"])
    with pytest.raises(ValueError):
        pack.compile_item(plan, key, {}, {"values": [
            {"name": "hair", "value": "long hair", "negative": ""}]})


def test_check_reports_twin_variables_and_puts_constraint_warnings_on_the_item():
    raw = _raw()
    raw["items"].append(_item(name="Scene Tags", var="scene_tags", section="Scene"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    # Scene Tags is a copy of Place: one option each, the same text.
    for k in ("Scene Tags", "Place"):
        built[keys[k]]["payload"]["options"] = [
            {"id": f"{k[:2]}1", "value": "cozy room", "weight": 1, "sub_categories": []}]
    report = pack.check_pack(plan, built, seeds=30)
    assert any("always holds the same text as $place" in t
               for t in report["problems"].get(keys["Scene Tags"], []))
    assert not any("same text" in t for t in report["problems"].get(keys["Hair"], []))


def test_a_constraint_that_never_applies_is_reported_on_the_constraint():
    raw = _raw()
    # A loop: one of the two constraints runs after its target.
    raw["items"].append(_item(kind="constraint", name="Outfit → Race", source="outfit",
                              target="race", section="Character", about="#robe gets #elf"))
    plan = pack.compile_plan(raw)
    report = pack.check_pack(plan, _built(plan), seeds=20)
    cons = {i["key"] for i in plan["items"] if i["kind"] == "constraint"}
    assert any("did not apply" in t for k in cons for t in report["problems"].get(k, []))
    assert not any("did not apply" in n for n in report["notes"])


# ── Parts of the plan that used to be dropped without a word ────────────


def test_an_input_never_erases_a_wildcard_a_constraint_needs():
    raw = _raw(inputs=[{"var": "race", "about": "the race", "example": "elf"},
                       {"var": "subject", "about": "who", "example": "a knight"}])
    plan = pack.compile_plan(raw)
    assert [i["var"] for i in plan["inputs"]] == ["subject"]
    assert any(i["var"] == "race" and i["kind"] == "wildcard" for i in plan["items"])
    assert any(i["kind"] == "constraint" for i in plan["items"])
    assert any("Dropped the input $race" in w for w in plan["warnings"])


def test_a_library_item_that_isnt_there_is_made_new():
    raw = _raw()
    raw["items"][3] = _item(kind="library", name="Hair Styles (User Library)", var="hair",
                            section="Character", about="the user's hair styles")
    raw["items"].insert(0, _item(kind="library", name="Style Preset", var="style",
                                 about="quality tags and negatives"))
    plan = pack.compile_plan(raw, [], settings={"library": "reuse"})
    by_var = {i["var"]: i for i in plan["items"] if i["var"]}
    assert by_var["hair"]["kind"] == "wildcard" and by_var["hair"]["name"] == "Hair Styles"
    assert by_var["style"]["kind"] == "fixed_values"
    assert any("Made Hair Styles new" in w for w in plan["warnings"])


def test_a_dropped_constraint_is_a_finding_and_a_check_note_until_it_is_planned():
    raw = _raw()
    raw["items"].append(_item(kind="constraint", name="Season → Outfit", source="season",
                              target="outfit", about="#winter never gets #robe"))
    plan = pack.compile_plan(raw)
    assert plan["dropped"][0]["name"] == "Season → Outfit"
    assert any("The constraint Season → Outfit was left out" in f["text"]
               for f in pack.review_plan(plan))
    report = pack.check_pack(plan, _built(plan), seeds=10)
    assert any("Season → Outfit isn't in the pack" in n for n in report["notes"])
    # The manager sends the plan back: still listed.
    again = pack.compile_plan(plan)
    assert again["dropped"] and again["dropped"][0]["why"].startswith("$season")
    # Once a Season wildcard is planned and the constraint with it, it goes away.
    fixed = pack.compile_plan({**plan, "items": [
        *plan["items"], _item(name="Season", var="season", tags=["winter"]),
        _item(kind="constraint", name="Season → Outfit", source="season", target="outfit",
              about="#winter never gets #robe")]})
    assert fixed["dropped"] == []


def test_the_template_is_told_about_a_pick_it_never_shows():
    raw = _raw()
    raw["items"].append(_item(name="Outerwear", var="outerwear", section="Outfit"))
    raw["items"].append(_item(kind="combine", name="Final", var="final_prompt",
                              about="$race $hair"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    built[keys["Final"]] = {"id": next(i["id"] for i in plan["items"] if i["name"] == "Final"),
                           "payload": {"template_string": "$race, $hair"}}
    report = pack.check_pack(plan, built, seeds=10)
    assert any("doesn't read $outerwear (Outerwear)" in t
               for t in report["problems"][keys["Prompt"]])
    assert "Nothing reads $final_prompt, so Final does nothing" in report["notes"]
    assert not any("$hair" in t for t in report["problems"].get(keys["Prompt"], []))


def test_rules_read_a_pick_instead_of_rolling_it_again():
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    race = next(i for i in plan["items"] if i["var"] == "race")
    payload = {"rules": [{"else_action": {"value": f"wandering @{{{race['id']}}}",
                                          "tagged": f"@{{{race['id']}:elf}}"}}]}
    out, said = pack.read_rolled(plan, built, payload)
    assert out["rules"][0]["else_action"]["value"] == "wandering $race"
    assert out["rules"][0]["else_action"]["tagged"] == f"@{{{race['id']}:elf}}"
    assert said == ["Reads $race instead of a new pick from Race"]


def test_tags_style_keeps_joined_variables_apart():
    assert pack.tag_commas("$hair $eyes $body.0, $x") == "$hair, $eyes, $body.0, $x"
    assert pack.tag_commas("$color hair, $x") == "$color hair, $x"
    plan = pack.compile_plan(_raw(items=[*_raw()["items"], _item(
        kind="combine", name="Look", var="look", about="$hair $race")]))
    key = next(i["key"] for i in plan["items"] if i["name"] == "Look")
    out = pack.compile_item(plan, key, _built(plan), {"template": "$hair $race", "negative": ""})
    assert out["payload"]["template"] == "$hair, $race"


# ── Round 2 of the real-model run ───────────────────────────────────────


def test_a_constraint_on_an_input_named_loosely_gets_a_wildcard():
    raw = _raw(inputs=[{"var": "season", "about": "the season", "example": "winter"}])
    raw["items"].append(_item(kind="constraint", name="Winter Footwear Rule",
                              source="the Season input", target="Outfit",
                              about="#winter never gets #robe"))
    plan = pack.compile_plan(raw)
    assert plan["inputs"] == []
    season = next(i for i in plan["items"] if i["var"] == "season")
    assert season["kind"] == "wildcard" and season["tags"] == ["winter"]
    rule = next(i for i in plan["items"] if i["name"] == "Winter Footwear Rule")
    assert (rule["source"], rule["target"]) == ("season", "outfit")
    assert plan["dropped"] == []
    assert any("Made the input $season a wildcard" in w for w in plan["warnings"])


def test_presets_without_a_variable_get_one_and_negatives_move_to_the_template():
    raw = _raw()
    raw["items"].insert(0, _item(kind="fixed_values", name="Quality Tags",
                                 about="masterpiece, best quality"))
    raw["items"].insert(0, _item(name="Base Negatives", var="base_negatives",
                                 about="lowres, bad hands"))
    plan = pack.compile_plan(raw)
    q = next(i for i in plan["items"] if i["name"] == "Quality Tags")
    assert q["var"] == "quality_tags"
    assert not any(i["name"] == "Base Negatives" for i in plan["items"])
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert "Standing negative: lowres, bad hands" in tpl["about"]


def test_a_rule_on_a_tag_or_a_piece_of_an_option_tests_what_is_there():
    from engine.ai import derivation as ai_derivation
    cat = {"race": {"name": "race", "sources": [{"kind": "wildcard", "module": "Race"}],
                    "values": ["pale skin, pointed ears", "green skin, tusks"], "tags": [],
                    "tagged": {"elf": ["pale skin, pointed ears"]}, "axes": []}}
    def rule(op, value):
        return {"summary": value, "branches": [{"match": "all", "conditions": [
            {"var": "race", "op": op, "value": value}], "actions": [
            {"target_var": "title", "mode": "replace", "value": "x"}]}], "else_actions": []}
    out = ai_derivation.compile_rules(
        {"rules": [rule("equals", "elf"), rule("not_equals", "tusks")]}, catalog=cat)
    tests = [r["rule"]["branches"][0]["condition"] for r in out["rules"]]
    assert tests[0]["op"] == "matches"
    assert tests[0]["value"] == "^(?:pale\\ skin,\\ pointed\\ ears)$"
    assert (tests[1]["op"], tests[1]["value"]) == ("not_contains", "tusks")


def test_bad_axis_reads_and_double_reads_and_unread_inputs():
    raw = _raw(inputs=[{"var": "gender", "about": "who", "example": "girl"}])
    raw["items"].append(_item(kind="combine", name="Look", var="look", about="$hair $race"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    look = pack.compile_item(plan, keys["Look"], built,
                             {"template": "$hair.tags, $race", "negative": ""})
    assert look["payload"]["template"] == "$hair, $race"
    assert any("Read $hair instead of $hair.tags" in w for w in look["warnings"])
    built[keys["Look"]] = {"id": look["id"], "payload": look["payload"]}
    built[keys["Prompt"]]["payload"]["template_string"] = "$look, $race, $outfit, $place, $light"
    report = pack.check_pack(plan, built, seeds=10)
    probs = report["problems"][keys["Prompt"]]
    assert any("reads $race and $look (Look)" in t for t in probs)
    assert any("doesn't read the input $gender" in t for t in probs)


def test_options_pointing_at_a_rolled_sibling_are_flagged_and_junk_dropped():
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    place = next(i for i in plan["items"] if i["var"] == "place")
    light = next(i for i in plan["items"] if i["var"] == "light")
    out = pack.compile_item(plan, light["key"], {k: v for k, v in built.items()
                                                 if k != light["key"]}, {"options": [
        {"text": f"lamp glow near @{{{place['id']}}} @@LIGHTING=night", "weight": 1,
         "tags": [], "negative": ""},
        {"text": "sunlight", "weight": 1, "tags": [], "negative": ""}]})
    assert any("points at Place, which the pack already rolls" in w for w in out["warnings"])
    assert all("@@" not in o["value"] for o in out["payload"]["options"])
    assert "already rolls" in out["repair"]
