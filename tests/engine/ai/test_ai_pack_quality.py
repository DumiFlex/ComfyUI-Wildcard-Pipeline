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
    # Round 12: both ways left one dead; the plan keeps the first one.
    assert any("make a loop" in w for w in plan["warnings"])
    assert [i["name"] for i in plan["items"] if i["kind"] == "constraint"] != []
    report = pack.check_pack(plan, _built(plan), seeds=20)
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


# ── Round 3 of the real-model run ───────────────────────────────────────


def test_library_references_that_name_the_library_are_not_made_new():
    raw = _raw()
    raw["items"].insert(0, _item(kind="library", name="User's Race Vocabulary",
                                 about="the user's race words"))
    raw["items"].insert(0, _item(kind="fixed_values", name="Quality", var="quality_tags",
                                 about="masterpiece"))
    raw["items"].insert(1, _item(kind="library", name="User's Quality Tags",
                                 about="their quality tags"))
    plan = pack.compile_plan(raw)
    names = [i["name"] for i in plan["items"]]
    assert not any("Vocabulary" in n for n in names) and "Quality Tags" not in names
    assert any("Left out Race Vocabulary" in w for w in plan["warnings"])
    # One warning for the quality tags, not "made new" and then "left out".
    assert not any("Made Quality Tags new" in w for w in plan["warnings"])
    assert any("Left out Quality Tags: $quality_tags is already set" in w
               for w in plan["warnings"])


def test_inputs_the_request_never_asked_for_and_picks_in_examples():
    raw = _raw(inputs=[
        {"var": "character_lora", "about": "a LoRA", "example": "<lora:x:0.8>"},
        {"var": "style_preset", "about": "a style", "example": "@{Style:cinematic}, film"}])
    raw["items"][-1]["about"] = "$race, $hair, $character_lora, $style_preset"
    plan = pack.compile_plan(raw, request="fantasy people in a style I type")
    assert [i["var"] for i in plan["inputs"]] == ["style_preset"]
    assert plan["inputs"][0]["example"] == "film"
    assert "$character_lora" not in plan["items"][-1]["about"]
    assert any("the request names no LoRA" in w for w in plan["warnings"])
    kept = pack.compile_plan(raw, request="use my character LoRA")
    # Only what the request names stays an input: nothing asked for a style.
    assert [i["var"] for i in kept["inputs"]] == ["character_lora"]
    # Nothing says the user brings anything: the pack rolls it instead.
    rolled = pack.compile_plan(raw, request="fantasy people in places")
    assert rolled["inputs"] == []
    style = next(i for i in rolled["items"] if i["var"] == "style_preset")
    assert style["kind"] == "wildcard" and "film" in style["about"]
    assert any("Made the input $style_preset a wildcard" in w for w in rolled["warnings"])


def test_never_rules_built_as_reduce_become_excludes_and_only_is_sent_back():
    raw = _raw()
    raw["items"][1]["about"] = "#elf never wears #armor"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    answer = {"rules": [{"source": "#elf", "target": "#armor", "effect": "reduce",
                         "factor": 0.1, "reason": "no"}]}
    out = pack.compile_item(plan, key, built, answer)
    assert out["payload"]["matrix"]["elf"]["armor"] == {"mode": "exclude", "factor": 0}
    assert any("Made its reduce rules exclude" in w for w in out["warnings"])
    plan["items"][[i["key"] for i in plan["items"]].index(key)]["about"] = \
        "#elf gets only #robe"
    out = pack.compile_item(plan, key, built, answer)
    row = out["payload"]["matrix"]["elf"]
    if "robe" in row:
        # The plan's own "gets only" lands as an only row, whatever the model wrote.
        assert row == {"robe": {"mode": "only", "factor": 1}}
    else:
        assert row["armor"]["mode"] == "reduce"
        assert "no rule is an only or exclude rule" in out["repair"]
    plan["items"][[i["key"] for i in plan["items"]].index(key)]["about"] = \
        "#elf rarely wears #armor"
    assert pack.compile_item(plan, key, built, answer)["repair"] == ""


def test_a_cut_off_rule_answer_keeps_what_it_finished_once():
    raw = _raw()
    raw["items"].insert(-1, _item(kind="derivation", name="Glow", var="glow",
                                  about="when $race is elf, add soft glow to $glow"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["name"] == "Glow")
    req = pack.item_request(plan, key, built)
    assert req["partial"] is True and "Write each rule and each branch once" in req["system"]
    branch = {"match": "all", "conditions": [{"var": "race", "op": "equals",
                                              "value": "race 0"}],
              "actions": [{"target_var": "glow", "mode": "append", "value": ", soft glow"}]}
    rule = {"summary": "glow", "branches": [branch, branch], "else_actions": []}
    out = pack.compile_item(plan, key, built, {"rules": [rule, rule], "_cut_off": True})
    rules = out["payload"]["rules"]
    assert len(rules) == 1 and len(rules[0]["branches"]) == 1
    # Nothing else sets $glow, so the append becomes a set without its ", ".
    action = rules[0]["branches"][0]["action"]
    assert (action["mode"], action["value"]) == ("replace", "soft glow")
    assert any("cut off" in w for w in out["warnings"])
    assert any("Sets $glow instead of adding to it" in w for w in out["warnings"])


def test_wildcards_hear_the_other_picks_and_constraint_only_picks_are_unseen():
    plan = pack.compile_plan(_raw())
    hair = next(i for i in plan["items"] if i["var"] == "hair")
    user = pack.item_request(plan, hair["key"], {})["user"]
    assert "Other picks in this pack" in user and "Outfit ($outfit)" in user
    assert "Hair ($hair)" not in user.split("Other picks")[1]
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    built[keys["Prompt"]]["payload"]["template_string"] = "$hair, $outfit, $place, $light"
    probs = pack.check_pack(plan, built, seeds=10)["problems"][keys["Prompt"]]
    assert any("doesn't read $race (Race): a constraint uses it" in t for t in probs)


def test_two_items_that_print_the_same_words_are_flagged():
    raw = _raw()
    raw["items"].insert(0, _item(kind="fixed_values", name="Quality", var="quality",
                                 about="q"))
    raw["items"].insert(1, _item(kind="fixed_values", name="Style", var="style", about="s"))
    raw["items"][-1]["about"] = "$quality, $style, $race, $hair, $outfit, $place, $light"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    ids = {i["name"]: i["id"] for i in plan["items"]}
    built[keys["Quality"]] = {"id": ids["Quality"], "payload": {"values": [
        {"id": "v1", "name": "quality", "value": "masterpiece, best quality"}]}}
    built[keys["Style"]] = {"id": ids["Style"], "payload": {"values": [
        {"id": "v2", "name": "style", "value": "anime style, masterpiece, best quality"}]}}
    built[keys["Prompt"]]["payload"]["template_string"] = raw["items"][-1]["about"]
    report = pack.check_pack(plan, built, seeds=10)
    said = report["problems"][keys["Style"]]
    assert any("repeats words $quality (Quality)" in t and '"masterpiece"' in t for t in said)
    assert keys["Quality"] not in report["problems"]


# ── Round 4 of the real-model run ───────────────────────────────────────


def test_a_match_no_option_can_meet_is_left_out():
    raw = _raw()
    raw["items"][3]["use"] = "match $race"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    hair = next(i for i in plan["items"] if i["var"] == "hair")
    out = pack.compile_item(plan, hair["key"], built, {"options": [
        {"text": t, "weight": 1, "tags": [], "negative": ""} for t in ("bob cut", "braid")]})
    assert any('Left out "match $race"' in w for w in out["warnings"])
    built[hair["key"]] = {"id": out["id"], "payload": out["payload"]}
    [mod] = [m for m in pack.chain_modules(plan, built) if m["id"] == out["id"]]
    assert "match_variable" not in mod["instance"]
    # An option that reads like a race keeps it.
    built[hair["key"]]["payload"]["options"][0]["value"] = "race 1"
    [mod] = [m for m in pack.chain_modules(plan, built) if m["id"] == out["id"]]
    assert mod["instance"]["match_variable"] == "race"


def test_a_weight_on_a_tag_weights_every_option_carrying_it():
    from engine.ai import use as ai_use
    payload = {"options": [{"id": "a", "value": "long hair", "sub_categories": ["long_hair"]},
                           {"id": "b", "value": "very long hair",
                            "sub_categories": ["long_hair"]},
                           {"id": "c", "value": "pixie cut", "sub_categories": ["short_hair"]}]}
    inst, notes = ai_use.parse_use("weight long_hair=3, #short_hair=1", kind="wildcard",
                                   payload=payload)
    assert inst["option_weights"] == {"a": 3, "b": 3, "c": 1} and notes == []
    inst, _ = ai_use.parse_use('weight "pixie cut"=2', kind="wildcard", payload=payload)
    assert inst["option_weights"] == {"c": 2}


def test_never_and_only_hold_with_boosts_alongside():
    raw = _raw()
    raw["items"][1]["about"] = "#elf never uses #armor; boost #robe"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    answer = {"rules": [
        {"source": "#elf", "target": "#armor", "effect": "reduce", "factor": 0.1, "reason": ""},
        {"source": "#elf", "target": "#robe", "effect": "boost", "factor": 2, "reason": ""}]}
    out = pack.compile_item(plan, key, built, answer)
    assert out["payload"]["matrix"]["elf"]["armor"]["mode"] == "exclude"
    assert out["payload"]["matrix"]["elf"]["robe"]["mode"] == "boost"
    plan["items"][[i["key"] for i in plan["items"]].index(key)]["about"] = \
        "#robe only for #elf"
    assert "no rule is an only or exclude rule" in pack.compile_item(
        plan, key, built, answer)["repair"]


def test_one_subject_split_per_case_is_a_review_fix_and_or_templates_warn():
    from engine.ai import text_items
    raw = _raw(items=[
        _item(name="Season", var="season", tags=["spring", "summer", "winter"]),
        *[_item(name=f"{s.title()} Top", var=f"{s}_top") for s in ("spring", "summer",
                                                                    "winter")],
        _item(name="Hair Color", var="hair_color"), _item(name="Eye Color", var="eye_color"),
        _item(name="Skin Color", var="skin_color"),
        _item(kind="template", name="T", about="$spring_top OR $summer_top")])
    plan = pack.compile_plan(raw)
    # Merged into one Top wildcard tagged by case, kept to the season.
    top = next(i for i in plan["items"] if i["var"] == "top")
    assert top["tags"] == ["spring", "summer", "winter"]
    assert not any(i["var"].endswith("_top") for i in plan["items"])
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert (rule["source"], rule["target"]) == ("season", "top")
    assert "#winter gets only #winter" in rule["about"]
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert tpl["about"] == "$top"
    assert any("Merged Spring Top, Summer Top, Winter Top into one Top" in w
               for w in plan["warnings"])
    assert {i["var"] for i in plan["items"]} >= {"hair_color", "eye_color", "skin_color"}
    # A plan sent in already built (no merge): the review says it.
    items = [*(i for i in plan["items"] if i["var"] != "top" and i["kind"] != "constraint")]
    shown = {**plan, "items": [*items, *[{**top, "key": f"x{n}", "var": f"{s}_top",
                                          "name": f"{s.title()} Top"}
                                         for n, s in enumerate(("spring", "summer", "winter"))]]}
    found = [f["text"] for f in pack.review_plan(shown)]
    assert any("Spring Top, Summer Top, Winter Top split one subject (top)" in t for t in found)
    assert not any("Hair Color" in t and "split" in t for t in found)
    out = text_items.compile_template({"template": "$spring_top OR $summer_top",
                                       "negative": ""})
    assert any('joins picks with "or"' in w for w in out["warnings"])
    assert "joins picks with" in pack.repair_note(out["warnings"])


def test_a_rule_adding_words_the_variable_holds_is_flagged():
    raw = _raw()
    raw["items"].insert(-1, _item(kind="derivation", name="Fog", var="light",
                                  about="append thick fog to $light"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    light = next(i for i in plan["items"] if i["name"] == "Light")
    for o in built[light["key"]]["payload"]["options"]:
        o["value"] = "dim, thick fog"
    built[keys["Fog"]] = {"id": next(i["id"] for i in plan["items"] if i["name"] == "Fog"),
                          "payload": {"rules": [{"id": "r1", "branches": [{
                              "condition": {"var": "light", "op": "exists", "value": ""},
                              "action": {"target_var": "light", "mode": "append",
                                         "value": ", thick fog"}}]}]}}
    report = pack.check_pack(plan, built, seeds=10)
    assert any("adds words the variable already holds" in t and "thick fog" in t
               for t in report["problems"][keys["Fog"]])


# ── Round 5 of the real-model run ───────────────────────────────────────


def test_a_grid_split_by_season_merges_and_its_rules_follow():
    raw = _raw(items=[
        _item(name="Season", var="season", about="winter, summer or mild weather"),
        *[_item(name=f"{c.title()} {r.title()}", var=f"{c}_{r}")
          for c in ("winter", "summer", "mild") for r in ("tops", "shoes")],
        _item(kind="constraint", name="No Sandals In Winter", source="season",
              target="$shoes", about="#winter never gets #sandals"),
        _item(kind="template", name="T",
              about="$winter_tops, $summer_tops, $mild_tops, $winter_shoes, $summer_shoes, "
                    "$mild_shoes")])
    plan = pack.compile_plan(raw)
    wild = {i["var"]: i for i in plan["items"] if i["kind"] == "wildcard"}
    assert set(wild) == {"season", "tops", "shoes"}
    assert wild["season"]["tags"] == ["winter", "summer", "mild"]
    rules = [(i["source"], i["target"]) for i in plan["items"] if i["kind"] == "constraint"]
    assert ("season", "tops") in rules and rules.count(("season", "shoes")) == 1
    assert next(i for i in plan["items"] if i["kind"] == "template")["about"] == \
        "$tops, $shoes"
    # Two subjects side by side, with nothing naming them as cases: kept.
    side = pack.compile_plan(_raw(items=[
        *[_item(name=f"{c} {r}", var=f"{c}_{r}") for c in ("upper", "lower")
          for r in ("body", "color")], _item(kind="template", name="T", about="$upper_body")]))
    assert {"upper_body", "lower_body"} <= {i["var"] for i in side["items"]}


def test_only_fills_the_sources_left_open_and_near_zero_never_excludes():
    raw = _raw()
    raw["items"][2]["tags"] = ["elf", "orc", "human", "dwarf"]
    raw["items"][1]["about"] = "#armor only for #orc"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    answer = {"rules": [
        {"source": "#orc", "target": "#armor", "effect": "boost", "factor": 2, "reason": ""},
        {"source": "#elf", "target": "#armor", "effect": "exclude", "factor": 0, "reason": ""}]}
    out = pack.compile_item(plan, key, built, answer)
    m = out["payload"]["matrix"]
    assert m["human"]["armor"]["mode"] == m["dwarf"]["armor"]["mode"] == "exclude"
    assert m["orc"]["armor"]["mode"] == "boost"
    assert any("Excluded #armor for #human" in w for w in out["warnings"])
    idx = [i["key"] for i in plan["items"]].index(key)
    plan["items"][idx]["about"] = "elves never wear armor, orcs mostly do"
    tiny = {"rules": [{"source": "#elf", "target": "#armor", "effect": "reduce",
                       "factor": 0.1, "reason": ""}]}
    assert pack.compile_item(plan, key, built, tiny)["payload"]["matrix"]["elf"]["armor"][
        "mode"] == "exclude"


def test_a_pick_only_a_rule_reads_is_flagged_and_no_empty_spellings():
    from engine.ai import use as ai_use
    assert ai_use.parse_use("filter not empty", kind="wildcard", tags=[])[0] == {
        "exclude_null": True}
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    built[keys["Prompt"]]["payload"]["template_string"] = "$race, $hair, $outfit, $place"
    plan["items"].insert(-1, {**plan["items"][3], "key": "i90", "id": "abcd9090",
                              "kind": "derivation", "name": "Mood", "var": "mood"})
    built["i90"] = {"id": "abcd9090", "payload": {"rules": [{"id": "r1", "branches": [{
        "condition": {"var": "light", "op": "exists", "value": ""},
        "action": {"target_var": "place", "mode": "append", "value": ", calm"}}]}]}}
    probs = pack.check_pack(plan, built, seeds=10)["problems"][keys["Prompt"]]
    assert any("$light (Light) never reaches the prompt" in t for t in probs)


# ── Round 6 of the real-model run ───────────────────────────────────────


def test_a_rule_on_a_tag_the_target_lacks_lands_on_options_that_say_it():
    from engine.ai import constraint as ai_constraint
    src = ai_constraint.side_view({"payload": {"options": [
        {"id": "a", "value": "tundra", "sub_categories": ["cold"]},
        {"id": "b", "value": "desert", "sub_categories": ["hot"]},
        {"id": "c", "value": "forest", "sub_categories": ["mild"]}],
        "sub_categories": ["cold", "hot", "mild"]}}, "S")
    tgt = ai_constraint.side_view({"payload": {"options": [
        {"id": "x", "value": "light snow", "sub_categories": ["cold_ok"]},
        {"id": "y", "value": "clear sky", "sub_categories": ["clear"]}],
        "sub_categories": ["cold_ok", "clear"]}}, "T")
    out = ai_constraint.compile_rules({"rules": [
        {"source": "#hot", "target": "#snow", "effect": "exclude", "factor": 0, "reason": ""},
        {"source": "#cold", "target": "#snow", "effect": "boost", "factor": 2, "reason": ""}]},
        source=src, target=tgt)
    pairs = {(e["exception"]["source"], e["exception"]["mode"]) for e in out["exceptions"]}
    assert pairs == {("desert", "exclude"), ("tundra", "boost")} and out["skipped"] == []
    # "Snow only in cold places": the forest, with no rule, is shut out too.
    payload = {"matrix": {}, "exceptions": [e["exception"] for e in out["exceptions"]]}
    said = pack._strict_rules({"name": "Snow", "about": "#snow only in #cold"}, payload, src)
    assert any(e["source"] == "forest" and e["mode"] == "exclude"
               for e in payload["exceptions"])
    assert said and "light snow for forest" in said[0]


def test_weight_clauses_add_up_and_templates_drop_reads_a_combine_holds():
    from engine.ai import use as ai_use
    payload = {"options": [{"id": "a", "value": "long hair", "sub_categories": ["long_hair"]},
                           {"id": "c", "value": "pixie cut", "sub_categories": ["short_hair"]}]}
    inst, _ = ai_use.parse_use("weight long_hair=3; weight short_hair=1", kind="wildcard",
                               payload=payload)
    assert inst["option_weights"] == {"a": 3, "c": 1}
    raw = _raw()
    raw["items"].insert(-1, _item(kind="combine", name="Who", var="who", about="$race $hair"))
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["name"]: i["key"] for i in plan["items"]}
    built[keys["Who"]] = {"id": "abcd7777", "payload": {
        "template": "$race, $hair", "output_var": "who", "input_vars": ["race", "hair"]}}
    out = pack.compile_item(plan, keys["Prompt"], built, {
        "template": "$race, $hair, $who, $outfit, $place, $light", "negative": ""})
    assert out["payload"]["template_string"] == "$who, $outfit, $place, $light"
    assert any("Dropped $race, $hair: $who (Who) already holds them" in w
               for w in out["warnings"])
    # $negatives in a template's plan isn't a variable the pack must set.
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    tpl["about"] += ", negative: lowres, $negatives"
    assert not any("$negatives" in f["text"] for f in pack.review_plan(plan))


def test_per_case_rules_merge_into_one_after_a_split_merges():
    raw = _raw(items=[
        _item(name="Biome", var="biome", tags=["forest", "desert", "ocean"]),
        *[_item(name=f"{c.title()} Animal", var=f"{c}_animal") for c in ("forest", "desert",
                                                                       "ocean")],
        *[_item(kind="constraint", name=f"{c} match", source="biome", target=f"{c}_animal",
                about=f"#{c} gets only #{c}") for c in ("forest", "desert", "ocean")],
        _item(kind="template", name="T", about="$forest_animal $desert_animal $ocean_animal")])
    plan = pack.compile_plan(raw)
    rules = [i for i in plan["items"] if i["kind"] == "constraint"]
    assert len(rules) == 1 and (rules[0]["source"], rules[0]["target"]) == ("biome", "animal")
    assert rules[0]["about"].count("gets only") == 3


# --- seventh real-model run -------------------------------------------------

def test_a_split_named_role_first_merges_and_its_selector_goes():
    cases = ("forest", "desert", "arctic")
    raw = _raw(items=[
        _item(name="Biome", var="biome", tags=list(cases)),
        *[_item(name=f"Animal {c.title()}", var=f"animal_{c}") for c in cases],
        _item(kind="derivation", name="Select Animal", var="animal",
              about="Set $animal to $animal_{$biome}"),
        *[_item(kind="constraint", name=f"{c} rule", source="biome", target=f"animal_{c}",
                about=f"#{c} gets only #{c}") for c in cases],
        _item(kind="template", name="T", about="$biome, $animal_, $animal")])
    plan = pack.compile_plan(raw)
    kinds = {(i["kind"], i["var"]) for i in plan["items"] if i["var"]}
    assert ("wildcard", "animal") in kinds and ("derivation", "animal") not in kinds
    assert not any(i["var"].startswith("animal_") for i in plan["items"])
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert "$animal_" not in tpl["about"] and tpl["about"].count("$animal") == 1
    assert any("Select Animal" in w for w in plan["warnings"])


def test_a_rule_naming_several_target_tags_lands_the_ones_that_exist():
    from engine.ai import constraint
    view = lambda prefix, opts: {"prefix": prefix, "tags": ["hot"], "options": [  # noqa: E731
        {"short": f"{prefix}{n}", "id": f"{prefix.lower()}{n}", "value": v, "tags": t}
        for n, (v, t) in enumerate(opts, 1)]}
    src = view("S", [("desert", ["hot"]), ("arctic", [])])
    tgt = view("T", [("camel", []), ("polar bear", [])])
    tgt["tags"] = ["dry"]  # listed, carried by nothing
    out = constraint.compile_rules({"rules": [
        {"source": "S1", "target": "#dry, #camel, #sand", "effect": "boost"}]},
        source=src, target=tgt)
    landed = {e["exception"]["target"] for e in out["exceptions"]}
    assert landed == {"camel"}
    assert any("#sand" in s["text"] for s in out["skipped"])


def test_weight_others_sets_every_unweighted_option():
    from engine.ai import use as ai_use
    payload = {"options": [{"id": "a", "value": "black", "sub_categories": ["solid"]},
                           {"id": "b", "value": "ombre", "sub_categories": []},
                           {"id": "c", "value": "white", "sub_categories": ["solid"]}]}
    out, notes = ai_use.parse_use("weight solid=3, others=1", kind="wildcard", payload=payload)
    assert not notes and out["option_weights"] == {"a": 3, "b": 1, "c": 3}


def test_an_input_the_request_doesnt_name_is_rolled_even_with_give_words():
    raw = _raw(inputs=[{"var": "character_gender", "about": "gender", "example": "Female"},
                       {"var": "pose", "about": "how they stand", "example": "sitting"}])
    raw["items"][-1]["about"] = "$race, $hair, $character_gender, $pose"
    plan = pack.compile_plan(raw, request="anime girls in poses I type")
    assert [i["var"] for i in plan["inputs"]] == ["pose"]
    assert any(i["var"] == "character_gender" and i["kind"] == "wildcard"
               for i in plan["items"])


def test_options_tagged_by_season_follow_the_season_pick():
    raw = _raw(items=[
        _item(name="Season", var="season", tags=["winter", "summer", "autumn"]),
        _item(name="Tops", var="tops", tags=["winter", "summer", "casual"],
              about="tops tagged by season"),
        _item(kind="constraint", name="No parka in summer", source="season", target="tops",
              about="#summer never gets parka"),
        _item(name="Shoes", var="shoes", tags=["winter", "summer"],
              about="shoes for each season"),
        _item(name="Hair", var="hair", tags=["winter", "summer"], about="hair colours"),
        _item(kind="template", name="T", about="$season, $tops, $shoes, $hair")])
    plan = pack.compile_plan(raw)
    rules = {(i["source"], i["target"]): i["about"] for i in plan["items"]
             if i["kind"] == "constraint"}
    assert "#winter gets only #winter" in rules[("season", "tops")]
    assert "parka" in rules[("season", "tops")]
    assert "#summer gets only #summer" in rules[("season", "shoes")]
    # Shared tags alone don't make one pick decide another.
    assert ("season", "hair") not in rules


def test_a_weapon_that_fits_the_class_gets_a_rule():
    raw = _raw(items=[
        _item(name="Class", var="class", tags=["warrior", "mage"]),
        _item(name="Weapon", var="weapon"),
        _item(kind="template", name="T", about="$class, $weapon")])
    plan = pack.compile_plan(raw, request="fantasy heroes with a weapon that fits the class")
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert (rule["source"], rule["target"]) == ("class", "weapon")
    assert any("the request says one fits the other" in w for w in plan["warnings"])


def test_two_wildcards_for_one_thing_are_a_review_fix():
    raw = _raw(items=[
        _item(name="Hair Color Base", var="hair_color_base"),
        _item(name="Hair Color Variation", var="hair_color_variation"),
        _item(name="Hair Length", var="hair_length"),
        _item(name="Hair Style", var="hair_style"),
        _item(kind="template", name="T",
              about="$hair_length, $hair_style, $hair_color_base, $hair_color_variation")])
    found = [f["text"] for f in pack.review_plan(pack.compile_plan(raw))
             if "both pick" in f["text"]]
    assert len(found) == 1 and "hair color" in found[0]


def test_an_outfit_that_already_names_the_shoes_is_a_problem():
    raw = _raw(items=[
        _item(name="Outfit", var="outfit"), _item(name="Shoes", var="shoes"),
        _item(kind="template", name="T", about="$outfit, $shoes")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["var"]: i["key"] for i in plan["items"] if i["var"]}
    built[keys["outfit"]]["payload"]["options"] = [
        {"id": "o1", "value": "casual wear, chinos, loafers", "weight": 1},
        {"id": "o2", "value": "t-shirt, jeans, sneakers", "weight": 1}]
    built[keys["shoes"]]["payload"]["options"] = [
        {"id": "s1", "value": "sneakers", "weight": 1},
        {"id": "s2", "value": "leather loafers", "weight": 1},
        {"id": "s3", "value": "boots", "weight": 1}]
    out = pack._overlaps(plan, built, "$outfit, $shoes")
    assert "sneakers" in out[keys["outfit"]] and keys["shoes"] not in out


# --- eighth real-model run --------------------------------------------------

def test_a_never_in_the_request_beats_a_reduce_in_the_plan():
    raw = _raw(items=[
        _item(name="Season", var="season", tags=["winter", "summer"]),
        _item(name="Footwear", var="footwear"),
        _item(kind="constraint", name="Winter Footwear", source="season", target="footwear",
              about="When season is winter, reduce odds of sandals."),
        _item(kind="constraint", name="Summer Shoes", source="season", target="footwear",
              about="When season is summer, reduce odds of boots."),
        _item(kind="template", name="T", about="$season, $footwear")])
    plan = pack.compile_plan(raw, request="seasonal outfits, no sandals in winter")
    rules = {i["name"]: i["about"] for i in plan["items"] if i["kind"] == "constraint"}
    assert "reduce odds" not in rules["Winter Footwear"]
    assert "never" in rules["Winter Footwear"].lower()
    assert "reduce odds of boots" in rules["Summer Shoes"]


def test_a_rule_on_an_untagged_target_gets_no_keep_rows():
    # Round 9: race keep-rows on weapons never tagged by race excluded every
    # weapon, so every hero held the fallback sword.
    raw = _raw(items=[
        _item(name="Race Options", var="race", tags=["elf", "human", "dwarf"]),
        _item(name="Weapon Options", var="weapon", tags=["bow", "sword", "gun"],
              about="Weapon carried by the character. Elves cannot use guns."),
        _item(kind="constraint", name="Elf Weapon", source="race", target="weapon",
              about="If race is Elf, exclude gun."),
        _item(kind="template", name="T", about="$race, $weapon")])
    raw["anchor"] = "race"
    plan = pack.compile_plan(raw)
    weapon = next(i for i in plan["items"] if i["var"] == "weapon")
    assert set(weapon["tags"]) == {"bow", "sword", "gun"}
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "gets only" not in rule["about"]


def test_one_pick_keeps_each_case_tagged_wildcard():
    cases = ["tundra", "forest", "desert"]
    raw = _raw(items=[
        _item(name="Biome", var="habitat", tags=cases),
        _item(name="Animal", var="animal", tags=cases, about="animals for each biome"),
        _item(name="Weather", var="weather", tags=cases, about="weather for each biome"),
        _item(kind="template", name="T", about="$habitat, $animal, $weather")])
    plan = pack.compile_plan(raw)
    into = [i["source"] for i in plan["items"]
            if i["kind"] == "constraint" and i["target"] == "weather"]
    assert into == ["habitat"]


def test_a_merged_part_named_without_dollar_becomes_its_tag_and_abouts_cut_cleanly():
    cases = ("forest", "desert", "arctic")
    raw = _raw(items=[
        _item(name="Biome", var="biome", tags=list(cases)),
        *[_item(name=f"{c.title()} Animal", var=f"{c}_animal") for c in cases],
        _item(kind="constraint", name="Habitat to Fauna", source="biome",
              target="forest_animal", about="When biome is forest, boost forest_animal; "
              "when desert, boost desert_animal"),
        _item(kind="template", name="T", about="$forest_animal $desert_animal $arctic_animal")])
    plan = pack.compile_plan(raw)
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "boost #forest" in rule["about"] and "_animal" not in rule["about"]
    assert pack._cut("#a gets only #a; #mountain gets only #mountain", 30) == \
        "#a gets only #a"


def test_a_rule_that_rolls_a_wildcard_again_is_sent_back():
    raw = _raw(items=[
        _item(name="Outerwear", var="outerwear"),
        _item(kind="derivation", name="Outfit", var="outfit_description",
              about="Writes $outerwear for winter"),
        _item(kind="template", name="T", about="$outerwear")])
    plan = pack.compile_plan(raw)
    payload = {"rules": [{"branches": [{"condition": {}, "action": {
        "target_var": "outerwear", "mode": "replace", "value": "@{Outerwear:heavy}"}}]}]}
    with pytest.raises(ValueError, match="a second time"):
        pack._second_rolls(plan, payload)
    # Round 12: summer forced a parka and appended sandals to the footwear.
    built = _built(plan)
    ok = {"target_var": "outfit_description", "mode": "replace", "value": "summer look"}
    payload = {"rules": [{"branches": [{"condition": {}, "action": {
        "target_var": "outerwear", "mode": "replace", "value": "@{Outerwear:parka}"},
        "extra_actions": [ok]}]}]}
    said = pack._second_rolls(plan, payload, built)
    assert said and payload["rules"][0]["branches"][0]["action"] == ok
    assert "extra_actions" not in payload["rules"][0]["branches"][0]
    wk = next(i["key"] for i in plan["items"] if i["var"] == "outerwear")
    built[wk]["payload"]["options"] = [{"id": "a", "value": "heavy down parka", "weight": 1}]
    payload = {"rules": [{"branches": [
        {"condition": {}, "action": {"target_var": "outerwear", "mode": "append",
                                     "value": ", light parka"}},
        {"condition": {}, "action": ok}]}]}
    said = pack._second_rolls(plan, payload, built)
    assert len(payload["rules"][0]["branches"]) == 1 and "two in the prompt" in said[0]


# --- ninth real-model run ---------------------------------------------------

def test_the_plans_gets_only_clauses_land_whatever_the_model_wrote():
    tags = ["winter", "summer"]
    src = {"tags": tags, "options": []}
    tgt = {"tags": tags, "options": [{"tags": ["winter"]}, {"tags": ["summer"]}]}
    matrix = {"winter": {"summer": {"mode": "exclude", "factor": 0}},
              "summer": {"winter": {"mode": "boost", "factor": 2}}}
    item = {"about": "When winter, never allow #summer.; #winter gets only #winter; "
                     "#summer gets only #summer; #spring gets only #spring"}
    said = pack._plan_onlys(item, src, tgt, matrix)
    assert matrix == {"winter": {"winter": {"mode": "only", "factor": 1},
                                 "summer": {"mode": "exclude", "factor": 0}},
                      "summer": {"summer": {"mode": "only", "factor": 1}}}
    assert said == ["#winter → #winter", "#summer → #summer"]


def test_a_sentence_template_keeps_its_reads_next_to_a_combine():
    raw = _raw(items=[
        _item(name="Top", var="top"), _item(name="Coat", var="coat"),
        _item(kind="combine", name="Coat Line", var="coat_line", about="$top under $coat"),
        _item(kind="template", name="T", about="wearing a $top, layered under $coat_line")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "combine")
    built[key] = {"id": "c0ffee00", "payload": {"template": "$top under $coat",
                                                "input_vars": ["top", "coat"]}}
    payload = {"template_string": "wearing a $top and $coat_line", "negative_template": ""}
    out, said = pack._drop_double_reads(plan, built, payload)
    assert out["template_string"] == "wearing a $top and $coat_line" and not said
    out, said = pack._drop_double_reads(plan, built, {**payload,
                                                      "template_string": "$top, $coat_line"})
    assert out["template_string"] == "$coat_line" and said


def test_a_combine_that_picks_inline_or_reads_the_templates_vars_is_sent_back():
    raw = _raw(items=[
        _item(name="Coat", var="coat"), _item(name="Quality", var="quality_tags"),
        _item(kind="combine", name="Coat Line", var="coat_line", about="joins $coat"),
        _item(kind="template", name="T", about="$quality_tags, $coat_line")])
    plan = pack.compile_plan(raw)
    item = next(i for i in plan["items"] if i["kind"] == "combine")
    said = pack._combine_notes(plan, item, {"template": "$quality_tags, {parka|trench coat}"})
    assert any("instead of reading $coat" in s for s in said)
    assert any("$quality_tags, which the template prints itself" in s for s in said)
    assert pack.repair_note(said)


# --- tenth real-model run ---------------------------------------------------

def test_a_constraint_with_blank_sides_takes_them_from_its_words():
    raw = _raw(items=[
        _item(name="Biome", var="biome", tags=["cold", "hot"]),
        _item(name="Weather", var="weather", tags=["snow", "rain"]),
        _item(kind="constraint", name="Snow Logic", source="", target="",
              about="Source: $biome, Target: $weather. #hot never gets #snow"),
        _item(kind="template", name="T", about="$biome, $weather")])
    plan = pack.compile_plan(raw)
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert (rule["source"], rule["target"]) == ("biome", "weather")


def test_role_suffixed_case_tags_become_the_cases():
    raw = _raw(items=[
        _item(name="Current Season", var="season", tags=["winter", "summer", "autumn"]),
        _item(name="Seasonal Top", var="top",
              tags=["winter_top", "summer_top", "autumn_top"]),
        _item(kind="constraint", name="Summer Top", source="season", target="top",
              about="When season is summer, never allow #winter_top."),
        _item(kind="template", name="T", about="$season, $top")])
    plan = pack.compile_plan(raw)
    top = next(i for i in plan["items"] if i["var"] == "top")
    assert top["tags"] == ["winter", "summer", "autumn"]
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "#winter." in rule["about"] or "#winter " in rule["about"]
    assert "#summer gets only #summer" in rule["about"]


def test_rule_tags_match_singular_plural_and_role_words():
    from engine.ai import constraint
    view = lambda prefix, tags, opts: {"prefix": prefix, "tags": tags, "options": [  # noqa: E731
        {"short": f"{prefix}{n}", "id": f"{prefix.lower()}{n}", "value": v, "tags": t}
        for n, (v, t) in enumerate(opts, 1)]}
    src = view("S", ["mage", "winter"], [("mage", ["mage"]), ("winter", ["winter"])])
    tgt = view("T", ["sandal", "staff"], [("espadrilles", ["sandals"]), ("oak staff", ["staff"])])
    out = constraint.compile_rules({"rules": [
        {"source": "#winter", "target": "#sandal", "effect": "exclude"},
        {"source": "#mage_weapons", "target": "#staff", "effect": "only"}]},
        source=src, target=tgt)
    assert not out["skipped"]
    assert {(c["source_tag"], c["target_tag"]) for c in out["cells"]} == {
        ("winter", "sandals"), ("mage", "staff")}


def test_never_in_the_request_reaches_a_rule_named_after_it():
    raw = _raw(items=[
        _item(name="Race", var="race", tags=["elf", "dwarf"]),
        _item(name="Weapon", var="weapon", tags=["gun", "bow"]),
        _item(kind="constraint", name="Elf Weapon Restriction", source="race",
              target="weapon", about="Elves rarely carry a gun"),
        _item(kind="template", name="T", about="$race, $weapon")])
    plan = pack.compile_plan(raw, request="fantasy heroes; elves never use guns")
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "Never: exclude it" in rule["about"]


def test_a_combine_that_writes_out_a_wildcards_options_is_sent_back():
    raw = _raw(items=[
        _item(name="Biome", var="biome"),
        _item(kind="combine", name="Habitat Phrase", var="habitat", about="joins $biome"),
        _item(kind="template", name="T", about="$habitat")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    bk = next(i["key"] for i in plan["items"] if i["var"] == "biome")
    built[bk]["payload"]["options"] = [
        {"id": "a", "value": "dense forest, tall trees", "weight": 1},
        {"id": "b", "value": "arid desert, sand dunes", "weight": 1}]
    item = next(i for i in plan["items"] if i["kind"] == "combine")
    said = pack._combine_notes(plan, item, {
        "template": "$biome, dense forest, tall trees, arid desert, sand dunes"}, built)
    assert any("writes out Biome's options itself" in s for s in said)


# --- eleventh real-model run ------------------------------------------------

def test_a_split_named_by_demonym_merges_onto_the_race_tags():
    raw = _raw(items=[
        _item(name="Race", var="race", tags=["elf", "dwarf", "human"]),
        *[_item(name=f"{c.title()} Traits", var=f"{c}_traits")
          for c in ("elven", "dwarven", "human")],
        _item(kind="template", name="T",
              about="$race, $elven_traits, $dwarven_traits, $human_traits")])
    plan = pack.compile_plan(raw)
    traits = next(i for i in plan["items"] if i["var"] == "traits")
    assert set(traits["tags"]) == {"elf", "dwarf", "human"}
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "#elf gets only #elf" in rule["about"]


def test_a_boost_only_rule_the_request_says_fits_becomes_only():
    raw = _raw(items=[
        _item(name="Class", var="class", tags=["mage", "warrior"]),
        _item(name="Weapon", var="weapon"),
        _item(kind="constraint", name="Class Weapon Match", source="class", target="weapon",
              about="Boost weapons that suit the class"),
        _item(kind="template", name="T", about="$class, $weapon")])
    plan = pack.compile_plan(raw, request="heroes with a weapon that fits the class")
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "gets only" in rule["about"] and "exclude the rest" in rule["about"]


def test_a_library_vocabulary_nothing_else_covers_is_made_new():
    raw = _raw(items=[
        _item(kind="library", name="Vocabulary (Colors)", var=""),
        _item(name="Eyes", var="eyes"),
        _item(kind="template", name="T", about="$eyes")])
    plan = pack.compile_plan(raw, library=[])
    assert any(i["name"] == "Colors" for i in plan["items"])


# --- twelfth real-model run -------------------------------------------------

def test_a_template_entry_with_its_own_words_and_a_twice_read_drop():
    raw = _raw(items=[
        _item(name="Weather", var="weather"), _item(name="Time", var="time_of_day"),
        _item(name="Quality", var="quality"),
        _item(kind="combine", name="Scene", var="scene", about="$time_of_day, $weather"),
        _item(kind="template", name="T", about="$quality, $scene, $time_of_day light, "
              "$weather conditions, $quality")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "combine")
    built[key] = {"id": "c0ffee01", "payload": {"template": "$time_of_day, $weather",
                                                "input_vars": ["time_of_day", "weather"]}}
    out, said = pack._drop_double_reads(plan, built, {
        "template_string": "$quality, $scene, $time_of_day light, $weather conditions, "
                           "$quality", "negative_template": ""})
    assert out["template_string"] == "$quality, $scene"
    assert any("once" in s for s in said)


def test_article_picks_go_and_inline_picks_in_a_join_are_sent_back():
    raw = _raw(items=[
        _item(name="Top", var="top"), _item(name="Coat", var="coat"),
        _item(kind="combine", name="Outfit", var="outfit", about="$top, $coat"),
        _item(kind="template", name="T", about="$outfit")])
    plan = pack.compile_plan(raw)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "combine")
    out = pack.compile_item(plan, key, _built(plan),
                            {"template": "$top, {a|b} $coat, {red|blue} scarf"})
    assert "{a|b}" not in out["payload"]["template"]
    assert "line that joins picks" in out["repair"]


# --- thirteenth real-model run ----------------------------------------------

def test_snow_only_in_cold_biomes_becomes_excludes_for_the_other_biomes():
    raw = _raw(anchor="", items=[
        _item(name="Biome", var="biome", tags=["cold", "hot", "temperate"]),
        _item(name="Weather", var="weather", about="rain, fog, snow or clear sky",
              tags=["wet", "dry"]),
        _item(kind="template", name="T", about="$biome, $weather")])
    plan = pack.compile_plan(raw, request="Landscape pack: biome, time of day, weather; "
                                          "snow only in cold biomes.")
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert (rule["source"], rule["target"]) == ("biome", "weather")
    assert "#snow only with #cold" in rule["about"]
    weather = next(i for i in plan["items"] if i["var"] == "weather")
    assert "snow" in weather["tags"]
    assert any("keeping #snow to #cold" in w for w in plan["warnings"])
    src = {"tags": ["cold", "hot", "temperate"], "options": []}
    tgt = {"tags": ["wet", "snow"], "options": [{"tags": ["snow"]}, {"tags": ["wet"]}]}
    matrix = {"hot": {"wet": {"mode": "boost", "factor": 2}}}
    said = pack._plan_only_withs(rule, src, tgt, matrix)
    assert matrix == {"hot": {"wet": {"mode": "boost", "factor": 2},
                              "snow": {"mode": "exclude", "factor": 0}},
                      "temperate": {"snow": {"mode": "exclude", "factor": 0}}}
    assert said == ["#snow only with #cold"]


def test_planner_conditions_and_dangling_articles_in_a_combine():
    raw = _raw(items=[
        _item(name="Top", var="top"), _item(name="Coat", var="coat"),
        _item(name="Weapon", var="weapon"),
        _item(kind="combine", name="Outfit", var="outfit", about="$top, $coat, $weapon"),
        _item(kind="template", name="T", about="$outfit")])
    plan = pack.compile_plan(raw)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "combine")
    out = pack.compile_item(plan, key, _built(plan), {
        "template": "wearing $top. If $coat is present: with $coat. wielding a, posing"})
    text = out["payload"]["template"]
    assert "If" not in text and "with $coat" in text
    assert "wielding $weapon, posing" in text
    assert any("condition" in w for w in out["warnings"])
    assert pack._plan_prose("$top (if any), $coat")[0] == "$top, $coat"
    text, said = pack._dangling("holding a, the,", plan, plan["items"][0], {})
    assert text == "holding a, the," and pack.repair_note(said)


def test_a_tag_name_printed_as_text_is_a_problem():
    raw = _raw(items=[
        _item(name="Outer", var="outer", tags=["summer_outer", "winter_outer"]),
        _item(kind="template", name="T", about="$outer")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["var"] == "outer")
    runs = [{"outer": "summer_outer"}] * 6
    out = pack._printed_names(plan, built, runs, "$outer", "")
    assert '"summer_outer"' in out[key]
    assert not pack._printed_names(plan, built, [{"outer": "linen shirt"}] * 6, "$outer", "")


# --- fourteenth real-model run ----------------------------------------------

def test_bare_pipes_become_one_pick():
    rows = [{"value": "morning light|golden hour"}, {"value": "{a|b} c"}, {"value": "dusk"}]
    said = pack._wrap_pipes(rows)
    assert [r["value"] for r in rows] == ["{morning light|golden hour}", "{a|b} c", "dusk"]
    assert said and "pick of one" in said[0]


def test_a_constraint_named_in_plain_words_gets_its_sides():
    x = {"name": "Biome to Climate", "about": "cold biomes boost cold climate",
         "source": "", "target": ""}
    pack._sides_from_about(x, {"biome": "Biome Types", "climate": "Climate"})
    assert (x["source"], x["target"]) == ("biome", "climate")


def test_a_library_item_made_new_next_to_its_own_wildcard_is_left_out():
    raw = _raw(items=[
        _item(name="Race", var="race", tags=["elf", "orc"]),
        _item(kind="library", name="Races", var="races"),
        _item(kind="template", name="T", about="$race")])
    plan = pack.compile_plan(raw)
    assert [i["var"] for i in plan["items"] if i["kind"] != "template"] == ["race"]
    assert any("Left out Races" in w and "already picks it" in w for w in plan["warnings"])


def test_an_unread_rule_is_a_template_problem_and_nested_combines_drop_reads():
    raw = _raw(items=[
        _item(name="Time", var="time"), _item(name="Race", var="race"),
        _item(kind="derivation", name="Night Lighting", var="lighting",
              about="when $time is night, set $lighting to moody light"),
        _item(kind="combine", name="Look", var="look", about="$race"),
        _item(kind="combine", name="Character", var="character", about="$look"),
        _item(kind="template", name="T", about="$time, $character, $look")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["var"]: i["key"] for i in plan["items"]}
    built[keys["lighting"]] = {"id": "d0d0d0d0", "payload": {"rules": [
        {"id": "r1", "branches": [{"when": {"var": "time", "op": "equals", "value": "night"},
                                   "action": {"var": "lighting", "mode": "write",
                                              "value": "moody light"}}]}]}}
    built[keys["look"]] = {"id": "c1c1c1c1", "payload": {"template": "$race",
                                                         "input_vars": ["race"]}}
    built[keys["character"]] = {"id": "c2c2c2c2", "payload": {"template": "$look",
                                                              "input_vars": ["look"]}}
    problems: dict = {}
    pack.unread_notes(plan, built, problems)
    tpl = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    assert any("Night Lighting" in p and "changes nothing" in p for p in problems[tpl])
    out, said = pack._drop_double_reads(
        plan, built, {"template_string": "$time, $character, $look", "negative_template": ""})
    assert out["template_string"] == "$time, $character" and said


# --- fifteenth real-model run -----------------------------------------------

def test_snow_stays_allowed_in_a_cold_row_that_keeps_only_cold():
    rule = {"about": "#snow only with #cold: every other Biome excludes #snow"}
    src = {"tags": ["cold", "hot"], "options": []}
    tgt = {"tags": ["cold", "snow"], "options": [{"tags": ["snow"]}, {"tags": ["cold"]}]}
    matrix = {"cold": {"cold": {"mode": "only", "factor": 1}}}
    pack._plan_only_withs(rule, src, tgt, matrix)
    assert matrix["cold"]["snow"] == {"mode": "only", "factor": 1}
    assert matrix["hot"]["snow"] == {"mode": "exclude", "factor": 0}


def test_two_things_that_fit_the_class_both_get_rules():
    raw = _raw(anchor="", items=[
        _item(name="Class", var="class", tags=["mage", "rogue"]),
        _item(name="Outfit", var="outfit"), _item(name="Weapon", var="weapon"),
        _item(name="Weapon Material", var="weapon_material"),
        _item(kind="template", name="T", about="$class, $outfit, $weapon, $weapon_material")])
    plan = pack.compile_plan(raw, request="race, class, an outfit and a weapon that fit "
                                          "the class.")
    rules = {(i["source"], i["target"]) for i in plan["items"] if i["kind"] == "constraint"}
    assert {("class", "outfit"), ("class", "weapon")} <= rules


def test_placeholder_options_go_and_overlapping_combines_are_sent_back():
    rows = [{"value": "no color variation"}, {"value": "None"}, {"value": "no makeup look"}]
    assert [bool(pack._PLACEHOLDER.search(r["value"])) for r in rows] == [True, True, False]
    raw = _raw(items=[
        _item(name="Race", var="race"), _item(name="Build", var="build"),
        _item(kind="combine", name="Body", var="body", about="$race, $build"),
        _item(kind="combine", name="Hero", var="hero", about="$build"),
        _item(kind="template", name="T", about="$body, $hero")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["var"]: i for i in plan["items"]}
    built[keys["body"]["key"]] = {"id": "c1c1c1c1", "payload": {
        "template": "$race, $build", "input_vars": ["race", "build"]}}
    built[keys["hero"]["key"]] = {"id": "c2c2c2c2", "payload": {
        "template": "$build", "input_vars": ["build"]}}
    said = pack._combine_notes(plan, keys["hero"], {"template": "$build"}, built)
    assert any("$body (Body) already joins" in s for s in said) and pack.repair_note(said)
    problems: dict = {}
    pack.unread_notes(plan, built, problems)
    assert any("already joins" in p for p in problems[keys["hero"]["key"]])


def test_empty_variables_leave_no_edge_commas_or_dangling_words():
    from engine.template import tidy_prompt
    assert tidy_prompt("dawn, cloudy day, ") == "dawn, cloudy day"
    assert tidy_prompt(", night, rain") == "night, rain"
    assert tidy_prompt("shadows with, gentle rain") == "shadows, gentle rain"
    assert tidy_prompt("standing in front of the house, rock and roll") == \
        "standing in front of the house, rock and roll"


# --- sixteenth real-model run -----------------------------------------------

def test_a_made_new_race_wildcard_next_to_race_is_left_out():
    raw = _raw(items=[
        _item(name="Race", var="race", tags=["elf", "orc"]),
        _item(kind="library", name="Race Wildcard", var=""),
        _item(kind="template", name="T", about="$race")])
    plan = pack.compile_plan(raw)
    assert [i["var"] for i in plan["items"] if i["kind"] != "template"] == ["race"]


def test_a_fit_rule_replaces_an_automatic_keep_rule_on_the_same_target():
    items = [
        {"kind": "wildcard", "name": "Race", "var": "race", "tags": ["elf"]},
        {"kind": "wildcard", "name": "Class", "var": "class", "tags": ["mage"]},
        {"kind": "constraint", "name": "Race → Outfit", "source": "race", "target": "outfit",
         "about": "#elf gets only #elf", "_auto": True},
        {"kind": "wildcard", "name": "Outfit", "var": "outfit", "tags": ["elf"]}]
    warnings: list = []
    out = pack._fit_rules(items, "an outfit that fits the class", warnings)
    rules = [(x["source"], x["target"]) for x in out if x["kind"] == "constraint"]
    assert rules == [("class", "outfit")]
    assert any("two keep rules" in w for w in warnings)


def test_the_template_starts_with_the_pick_the_others_follow_and_double_articles_go():
    from engine.template import tidy_prompt
    raw = _raw(anchor="season", items=[
        _item(name="Season", var="season", tags=["winter", "summer"]),
        _item(name="Top", var="top", tags=["winter", "summer"]),
        _item(kind="constraint", name="Season → Top", source="season", target="top",
              about="#winter gets only #winter"),
        _item(kind="template", name="T", about="wearing $top")])
    plan = pack.compile_plan(raw)
    text, said = pack._lead_with_anchor("wearing $top", plan, _built(plan))
    assert text == "$season, wearing $top" and said
    assert tidy_prompt("wearing a a striped shirt") == "wearing a striped shirt"


# --- seventeenth real-model run ---------------------------------------------

def test_a_rule_planned_the_wrong_way_is_turned_around_by_the_request():
    items = [
        {"kind": "wildcard", "name": "Biome", "var": "biome", "tags": ["desert", "arctic"],
         "about": "the habitat"},
        {"kind": "constraint", "name": "Biome → Animal", "source": "biome",
         "target": "animal", "about": "#desert gets only #desert"},
        {"kind": "wildcard", "name": "Animal", "var": "animal", "tags": ["desert", "arctic"]}]
    warnings: list = []
    out = pack._fit_rules(items, "Animals in habitats: the animal decides which habitats "
                                 "are possible.", warnings)
    rule = next(x for x in out if x["kind"] == "constraint")
    assert (rule["source"], rule["target"]) == ("animal", "biome")
    assert any("Turned Biome → Animal around" in w for w in warnings)


# --- eighteenth real-model run ----------------------------------------------

def test_labels_doubled_words_and_list_options_go():
    text, said = pack._plan_prose("$season, Footwear: $shoes, wearing wearing $top. "
                                  "Layering note: $coat")
    assert "Footwear" not in text and "Layering" not in text and "wearing wearing" not in text
    assert said and pack._plan_prose("($top:1.2), $coat")[0] == "($top:1.2), $coat"
    opts = [{"value": v} for v in ("staff", "wand", "sword", "axe",
                                   "staff, wand, sword, axe, bow")]
    assert pack._list_options(opts) == [opts[-1]]


# --- nineteenth real-model run ----------------------------------------------

def test_merged_case_reads_and_doubled_nouns_are_folded():
    raw = _raw(anchor="", items=[
        _item(name="Outfit", var="outfit", tags=["summer", "autumn"]),
        _item(name="Hair Color", var="hair_color"),
        _item(kind="template", name="T", about="$outfit, $hair_color")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["var"] == "hair_color")
    built[key]["payload"]["options"] = [{"id": "h1", "value": "white hair", "weight": 1},
                                        {"id": "h2", "value": "red hair", "weight": 1}]
    text, said = pack._fold_case_reads("$outfit_summer, $outfit_autumn, $hair_color hair",
                                       plan, built)
    assert text == "$outfit, $hair_color" and len(said) == 3


def test_an_item_that_lists_every_option_is_a_problem():
    raw = _raw(items=[
        _item(name="Hair", var="hair"),
        _item(kind="fixed_values", name="Look", var="look"),
        _item(kind="template", name="T", about="$look")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = {i["var"]: i["key"] for i in plan["items"]}
    built[keys["look"]] = {"id": "f0f0f0f0", "payload": {"values": [
        {"id": "v1", "name": "look", "value": "hair 0, hair 1, hair 2, hair 3"}]}}
    out = pack._lists_all(plan, built, [{"look": "hair 0, hair 1, hair 2, hair 3"}] * 4)
    assert "options at once" in out[keys["look"]]


def test_the_species_decides_the_habitat_not_its_class():
    items = [
        {"kind": "wildcard", "name": "Class", "var": "animal_class", "tags": ["mammal"]},
        {"kind": "wildcard", "name": "Species", "var": "animal_species", "tags": ["mammal"]},
        {"kind": "constraint", "name": "Class to Habitat", "source": "animal_class",
         "target": "habitat_type", "about": "#mammal gets only #forest"},
        {"kind": "wildcard", "name": "Habitat", "var": "habitat_type",
         "tags": ["forest", "ocean"]}]
    warnings: list = []
    out = pack._fit_rules(items, "the animal decides which habitats are possible.", warnings)
    rules = [(x["source"], x["target"]) for x in out if x["kind"] == "constraint"]
    assert rules == [("animal_species", "habitat_type")]
    species = next(x for x in out if x.get("var") == "animal_species")
    assert {"forest", "ocean"} <= set(species["tags"])


# --- twentieth real-model run -----------------------------------------------


def test_tag_ids_as_option_text_get_spaces():
    rows = [{"value": "polar_bear"}, {"value": "$snow_kind on @{abcd1234}"},
            {"value": "red fox"}]
    said = pack._snake_text(rows)
    assert [r["value"] for r in rows] == ["polar bear", "$snow_kind on @{abcd1234}", "red fox"]
    assert said and "underscores" in said[0]


def test_snow_in_other_words_follows_the_only_in_rule():
    raw = _raw(anchor="biome", items=[
        _item(name="Biome", var="biome", tags=["cold", "warm"]),
        _item(name="Weather", var="weather", tags=["clear"], about="rain, snow or clear skies"),
        _item(name="Wind", var="wind"),
        _item(kind="template", name="T", about="$biome, $weather, $wind")])
    plan = pack.compile_plan(raw, request="Landscape pack: biome, weather; snow only in "
                             "cold biomes.")
    rule = next(i for i in plan["items"] if i["kind"] == "constraint")
    assert "#snow only with #cold" in rule["about"]
    keys = {i["var"]: i["key"] for i in plan["items"]}
    out = pack.compile_item(plan, keys["weather"], {}, {"options": [
        {"text": t, "weight": 1, "tags": tags, "negative": ""} for t, tags in (
            ("light snowfall", ["snow"]), ("blizzard winds howling", []),
            ("clear sky", ["clear"]))]})
    tagged = {o["value"]: o.get("sub_categories") for o in out["payload"]["options"]}
    assert "snow" in tagged["blizzard winds howling"]
    wind = pack.compile_item(plan, keys["wind"], {}, {"options": [
        {"text": t, "weight": 1, "tags": [], "negative": ""} for t in (
            "snow driven by wind", "gentle breeze", "still air", "gusts")]})
    assert [o["value"] for o in wind["payload"]["options"]] == [
        "gentle breeze", "still air", "gusts"]
    assert any("only $weather follows" in w for w in wind["warnings"])


def test_a_rule_keyed_on_tags_neither_side_has_tags_them():
    raw = _raw(anchor="char_class", items=[
        _item(name="Class", var="char_class", tags=["melee"]),
        _item(name="Weapon", var="weapon", tags=["blade"]),
        _item(kind="constraint", name="Class → Weapon", source="char_class",
              target="weapon", about="#rogue gets only #dagger; #mage → #staff"),
        _item(kind="template", name="T", about="$char_class, $weapon")])
    plan = pack.compile_plan(raw)
    tags = {i["var"]: i["tags"] for i in plan["items"] if i["kind"] == "wildcard"}
    assert {"rogue", "mage"} <= set(tags["char_class"])
    assert {"dagger", "staff"} <= set(tags["weapon"])
    assert not any("which neither" in f["text"] for f in pack.review_plan(plan))


def test_a_subject_the_request_never_asks_for_is_left_out():
    raw = _raw(anchor="subject", items=[
        _item(name="Subject", var="subject"), _item(name="Weather", var="weather"),
        _item(name="Time", var="time_of_day"),
        _item(kind="template", name="T", about="$subject, $weather, $time_of_day")])
    plan = pack.compile_plan(raw, request="A weather wildcard and a time of day; night "
                             "scenes get moody lighting.")
    assert "subject" not in {i["var"] for i in plan["items"]}
    assert any("asks for no subject" in w for w in plan["warnings"])
    kept = pack.compile_plan(_raw(anchor="subject", items=[
        _item(name="Subject", var="subject"),
        _item(kind="template", name="T", about="$subject")]),
        request="Portraits in the rain")
    assert "subject" in {i["var"] for i in kept["items"]}


def test_the_extras_follow_the_pick_the_request_says_is_decided():
    items = [
        {"kind": "wildcard", "name": "Species", "var": "animal", "tags": []},
        {"kind": "wildcard", "name": "Habitat", "var": "habitat", "tags": ["ocean", "desert"]},
        {"kind": "wildcard", "name": "Action", "var": "animal_action", "tags": []},
        {"kind": "wildcard", "name": "Light", "var": "lighting", "tags": []}]
    warnings: list = []
    out = pack._fit_rules(items, "Animals in habitats: the animal decides which habitats "
                          "are possible.", warnings)
    rules = {(x["source"], x["target"]) for x in out if x["kind"] == "constraint"}
    assert {("animal", "habitat"), ("habitat", "animal_action"),
            ("habitat", "lighting")} <= rules
    action = next(x for x in out if x.get("var") == "animal_action")
    assert {"ocean", "desert"} <= set(action["tags"])


def test_a_combine_of_phrases_side_by_side_gets_commas():
    raw = _raw(items=[
        _item(name="Top", var="top"), _item(name="Bottom", var="bottom"),
        _item(kind="combine", name="Outfit", var="outfit", about="$top $bottom"),
        _item(kind="template", name="T", about="$outfit")])
    plan = pack.compile_plan(raw)
    built = _built(plan)
    text, said = pack._bare_join("$top $bottom", plan, built)
    assert text == "$top, $bottom" and said
    for o in built[next(i["key"] for i in plan["items"] if i["var"] == "top")][
            "payload"]["options"]:
        o["value"] = "red"
    assert pack._bare_join("$top $bottom", plan, built) == ("$top $bottom", [])
