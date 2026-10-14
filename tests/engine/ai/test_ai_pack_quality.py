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
    assert len(kept["inputs"]) == 2
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
    assert out["payload"]["matrix"]["elf"]["armor"]["mode"] == "reduce"
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
