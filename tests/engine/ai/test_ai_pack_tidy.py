"""Pack fixes that need no model (engine/ai/pack_tidy.py)."""
from __future__ import annotations

from engine.ai import pack, pack_tidy
from tests.engine.ai.test_ai_pack_v2 import _built, _item, _raw


def _keys(plan):
    return {i["name"]: i["key"] for i in plan["items"]}


def _with_quality():
    raw = _raw()
    raw["items"].insert(0, _item(kind="fixed_values", name="Quality", var="quality", about="q"))
    raw["items"][-1]["about"] = "$quality, $race, $hair, $outfit, $place, $light"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = _keys(plan)
    built[keys["Quality"]] = {"id": plan["items"][0]["id"], "payload": {"values": [
        {"id": "v1", "name": "quality", "value": "masterpiece, best quality"}]}}
    built[keys["Prompt"]]["payload"]["template_string"] = raw["items"][-1]["about"]
    return plan, built, keys


def test_words_said_twice_go_from_the_later_item_when_nothing_is_lost():
    plan, built, keys = _with_quality()
    # Every light option also says "best quality": always a repeat.
    light = built[keys["Light"]]["payload"]
    for o in light["options"]:
        o["value"] += ", best quality"
    new, changed = pack_tidy.tidy(plan, built)
    assert set(changed) == {keys["Light"]}
    assert all("best quality" not in o["value"] for o in new[keys["Light"]]["payload"]["options"])
    assert any('"best quality"' in w for w in changed[keys["Light"]]["warnings"])
    assert changed[keys["Light"]]["preview"]
    # The input is left as it was.
    assert all("best quality" in o["value"] for o in light["options"])
    tested = pack_tidy.runs(plan, new)
    assert all(t["prompt"].count("best quality") == 1 for t in tested)


def test_a_piece_said_twice_only_sometimes_stays():
    plan, built, keys = _with_quality()
    built[keys["Quality"]]["payload"]["values"][0]["value"] = "masterpiece"
    # Only one hair option repeats "golden"; the light that says it too is
    # a separate roll, so taking it out would lose it in other runs.
    built[keys["Hair"]]["payload"]["options"][0]["value"] = "hair 0, golden"
    built[keys["Light"]]["payload"]["options"][0]["value"] = "light 0, golden"
    new, changed = pack_tidy.tidy(plan, built)
    assert changed == {}
    assert new[keys["Hair"]]["payload"] == built[keys["Hair"]]["payload"]


def test_sibling_picks_come_out_whatever_order_they_were_built_in():
    plan, built, keys = _with_quality()
    # Outfit was built before Hair, so the build couldn't see Hair's options.
    built[keys["Outfit"]]["payload"]["options"][1]["value"] = "outfit 1, hair 2"
    new, changed = pack_tidy.tidy(plan, built)
    assert new[keys["Outfit"]]["payload"]["options"][1]["value"] == "outfit 1"
    assert any("Hair picks that" in w for w in changed[keys["Outfit"]]["warnings"])


def test_a_prompt_showing_what_a_rule_excludes_names_the_item_that_printed_it():
    raw = _raw()
    raw["items"][-1]["about"] = "$race, $outfit, $place"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = _keys(plan)
    built[keys["Prompt"]]["payload"]["template_string"] = "$race, $outfit, $place"
    # Elves never wear armour (outfits 1 and 3 are #armor); the places
    # mention it anyway.
    for o in built[keys["Place"]]["payload"]["options"]:
        o["value"] += ", outfit 1"
    report = pack.check_pack(plan, built, seeds=40)
    said = report["problems"].get(keys["Place"]) or []
    assert any('"outfit 1"' in t and "Race → Outfit rules out" in t for t in said), said
    # The outfit pick itself follows the rule, so it is never blamed.
    assert not any("rules out" in t for t in report["problems"].get(keys["Outfit"]) or [])


def test_a_rule_that_writes_the_same_thing_for_many_values_is_joined():
    payload = {"rules": [{"id": "r1", "branches": [
        {"condition": {"var": "weather", "op": "equals", "value": v},
         "action": {"target_var": "light", "mode": "replace", "value": out}}
        for v, out in [("rain", "dim"), ("fog", "dim"), ("storm", "dim"), ("sun", "bright"),
                       ("clear", "bright")]]}]}
    out, said = pack_tidy.merge_lookup(payload)
    branches = out["rules"][0]["branches"]
    assert len(branches) == 2 and said
    assert branches[0]["condition"]["match"] == "any"
    assert [c["value"] for c in branches[0]["condition"]["conditions"]] == ["rain", "fog", "storm"]
    for weather, light in [("fog", "dim"), ("clear", "bright")]:
        cond = next(b for b in branches if weather in str(b["condition"]))
        assert cond["action"]["value"] == light
    # Mixed tests or one value per branch stay as they were.
    mixed = {"rules": [{"id": "r", "branches": [
        {"condition": {"var": "a", "op": "contains", "value": "x"},
         "action": {"target_var": "b", "mode": "replace", "value": "1"}}] * 3}]}
    assert pack_tidy.merge_lookup(mixed) == (mixed, [])


def test_a_template_the_model_never_answered_reads_every_pick():
    plan, built, keys = _with_quality()
    del built[keys["Prompt"]]
    answer = pack_tidy.fallback_template(plan, built)
    # The plan's description names the order.
    assert answer["template"] == "$quality, $race, $hair, $outfit, $place, $light"
    assert answer["negative"].endswith("$negatives")
    out = pack_tidy.fallback_item(plan, keys["Prompt"], built, "no template")
    assert out["payload"]["template_string"].startswith("$quality")
    assert "plain template" in out["warnings"][0] and out["repair"] == ""
    # Without names in the description: every pick in run order.
    plan["items"][-1]["about"] = "the prompt"
    reads = pack_tidy.fallback_template(plan, built)["template"]
    assert {"$race", "$hair", "$outfit", "$place", "$light", "$quality"} == set(reads.split(", "))


def test_a_rule_that_leaves_its_target_nothing_names_the_target():
    plan = pack.compile_plan(_raw())
    built = _built(plan)
    keys = _keys(plan)
    assert pack_tidy.dead_ends(plan, built) == {}
    # Every outfit is armour, which elves never wear.
    for o in built[keys["Outfit"]]["payload"]["options"]:
        o["sub_categories"] = ["armor"]
    said = pack_tidy.dead_ends(plan, built)
    assert set(said) == {keys["Outfit"]}
    assert "rules out every option" in said[keys["Outfit"]] and "$race" in said[keys["Outfit"]]
    report = pack.check_pack(plan, built, seeds=20)
    assert any("rules out every option" in t for t in report["problems"][keys["Outfit"]])
    # An empty option is always left, so nothing is stuck.
    built[keys["Outfit"]]["payload"]["options"].append({"id": "n", "value": "", "is_null": True})
    assert pack_tidy.dead_ends(plan, built) == {}


def test_a_retry_after_a_cut_off_answer_is_asked_cooler_and_shorter():
    plan = pack.compile_plan(_raw())
    key = _keys(plan)["Prompt"]
    first = pack.item_request(plan, key, _built(plan))
    again = pack.item_request(plan, key, _built(plan), "your last answer failed: the model's "
                              "answer was cut off at its output limit")
    assert pack.CUT_RETRY not in first["user"] and pack.CUT_RETRY in again["user"]
    assert again["temperature"] <= 0.2


def test_a_rule_that_leaves_its_target_nothing_gets_an_empty_option_only_there():
    from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor

    plan = pack.compile_plan(_raw())
    built = _built(plan)
    keys = _keys(plan)
    for o in built[keys["Outfit"]]["payload"]["options"]:
        o["sub_categories"] = ["armor"]
    new, changed = pack_tidy.tidy(plan, built)
    assert {keys["Outfit"], keys["Race → Outfit"]} <= set(changed)
    assert any("empty option" in w for w in changed[keys["Outfit"]]["warnings"])
    assert changed[keys["Race → Outfit"]]["preview"]
    assert pack_tidy.dead_ends(plan, new) == {}
    options = new[keys["Outfit"]]["payload"]["options"]
    rule = new[keys["Race → Outfit"]]["payload"]
    for race in new[keys["Race"]]["payload"]["options"]:
        pick = {"value": race["value"], "tags": race.get("sub_categories") or []}
        live = [o for o in options if combine_constraint_factor(
            [pick], {"value": o["value"], "tags": o.get("sub_categories") or []},
            rule["matrix"], rule["exceptions"]) is not EXCLUDE]
        if "elf" in pick["tags"]:
            assert [o.get("is_null") for o in live] == [True]  # nothing, not armour
        else:
            assert live and not any(o.get("is_null") for o in live)  # chances unchanged
    # The pack really renders that way.
    elves = {o["value"] for o in new[keys["Race"]]["payload"]["options"]
             if "elf" in (o.get("sub_categories") or [])}
    seen = [bool(r["ctx"].get("outfit")) for r in pack_tidy.runs(plan, new)
            if r["ctx"].get("race") in elves]
    assert seen and not any(seen)
    assert all(o.get("sub_categories") == ["armor"] for o in
               built[keys["Outfit"]]["payload"]["options"])  # input untouched


def _with_hair_colour(always=True):
    raw = _raw()
    raw["items"].insert(3, _item(name="Hair Colour", var="hair_color", section="Character"))
    raw["items"][-1]["about"] = "$race, $hair_color hair, $hair, $outfit, $place"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = _keys(plan)
    built[keys["Prompt"]]["payload"]["template_string"] = raw["items"][-1]["about"]
    colours = built[keys["Hair Colour"]]["payload"]["options"]
    names = ["silver", "jet black", "red", "blonde", "auburn", "pink"]
    for o, c in zip(colours, names, strict=False):
        o["value"] = c
    if not always:
        colours.append({"id": "nn", "value": "", "is_null": True, "weight": 3})
    hair = built[keys["Hair"]]["payload"]["options"]
    hair[0]["value"] = "long jet black hair, ponytail"
    hair[1]["value"] = "short Red hair"
    hair[2]["value"] = "red ribbon, braid"  # not about hair colour: kept
    built[keys["Outfit"]]["payload"]["options"][0]["value"] = "red dress"  # another subject
    return plan, built, keys


def test_a_colour_the_hair_options_repeat_comes_out_of_them():
    plan, built, keys = _with_hair_colour()
    new, changed = pack_tidy.tidy(plan, built)
    hair = [o["value"] for o in new[keys["Hair"]]["payload"]["options"]]
    assert hair[:3] == ["long hair, ponytail", "short hair", "red ribbon, braid"]
    assert any('"jet black"' in w and "Hair Colour" in w for w in changed[keys["Hair"]]["warnings"])
    assert new[keys["Outfit"]]["payload"]["options"][0]["value"] == "red dress"
    # A colour wildcard that sometimes picks nothing keeps the hair's own colours.
    plan, built, keys = _with_hair_colour(always=False)
    new, changed = pack_tidy.tidy(plan, built)
    assert new[keys["Hair"]]["payload"]["options"][0]["value"].startswith("long jet black hair")
    assert keys["Hair"] not in changed


def test_a_colour_spelled_differently_still_comes_out_of_the_hair_options():
    plan, built, keys = _with_hair_colour()
    hair = built[keys["Hair"]]["payload"]["options"]
    hair[0]["value"] = "long hair, sleek platinum blonde hair"
    hair[1]["value"] = "lemon blonde hair, bob cut"
    new, changed = pack_tidy.tidy(plan, built)
    got = [o["value"] for o in new[keys["Hair"]]["payload"]["options"]]
    assert got[:2] == ["long hair, sleek hair", "bob cut"]
    assert keys["Hair"] in changed


def test_hair_colours_are_added_when_only_an_about_mentions_colour():
    raw = _raw()
    raw["items"] = [_item(name="Hair Styles", var="hair_style", section="Character",
                          about="hairstyles with colours"),
                    _item(kind="template", name="Prompt", about="$hair_style")]
    plan = pack.compile_plan(raw, request="Hairstyles and hair colours")
    assert "Hair Colour" in [i["name"] for i in plan["items"]]


def test_a_colour_missing_from_many_prompts_is_named():
    plan, built, keys = _with_hair_colour(always=False)
    done = pack_tidy.runs(plan, built)
    said = pack_tidy.missing_attributes(plan, built, done)
    assert "drop the empty option" in said[keys["Hair Colour"]]
    plan, built, keys = _with_hair_colour()
    assert pack_tidy.missing_attributes(plan, built, pack_tidy.runs(plan, built)) == {}
    # A list only seen through what draws from it is never named (118d:
    # "28 of 32 prompts show no color list" on an internal Color List).
    plan, built, keys = _with_hair_colour(always=False)
    hair = next(i for i in plan["items"] if i["name"] == "Hair Colour")
    plan = {**plan, "graph": {"slots": [{"name": "Hair Colour", "var": hair["var"],
                                         "show": "internal"}], "relations": []}}
    assert keys["Hair Colour"] not in pack_tidy.missing_attributes(plan, built, done)


def test_hair_colours_the_request_asks_for_get_a_wildcard_when_the_plan_forgot():
    raw = _raw()
    raw["items"] = [_item(name="Hair Styles", var="hair_style", section="Character"),
                    _item(name="Hair Length", var="hair_length", section="Character"),
                    _item(kind="template", name="Prompt", about="$hair_length, $hair_style")]
    plan = pack.compile_plan(raw, request="Hairstyles and hair colours, long styles more common")
    names = [i["name"] for i in plan["items"]]
    assert "Hair Colour" in names
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    assert "$hair_color, $hair_style" in tpl["about"]
    assert any("Added Hair Colour" in w for w in plan["warnings"])
    # A plan that has one is left alone, and so is a request about other colours.
    raw["items"].insert(0, _item(name="Hair Tint", var="hair_tint", section="Character"))
    again = pack.compile_plan(raw, request="hairstyles and hair colours")
    assert "Hair Colour" not in [i["name"] for i in again["items"]]
    other = pack.compile_plan(_raw(), request="fantasy people in different colours")
    assert not any("Colour" in i["name"] for i in other["items"])


def test_two_wildcards_for_one_colour_or_length_are_twins():
    w = [{"var": v, "name": v} for v in ("hair_color", "hair_tone", "hair_style")]
    assert [(a["var"], b["var"]) for a, b, _ in pack._twin_picks(w)] == [
        ("hair_color", "hair_tone")]
    w = [{"var": v, "name": v} for v in ("hair_length", "hair_length_bias", "eye_color")]
    assert len(pack._twin_picks(w)) == 1


def test_a_variable_the_template_reads_twice_loses_its_second_read():
    plan, built, keys = _with_quality()
    tpl = built[keys["Prompt"]]["payload"]
    tpl["template_string"] = "$quality, $race, $hair, $outfit, $place, $light, $hair"
    new, changed = pack_tidy.tidy(plan, built)
    assert keys["Prompt"] in changed
    assert new[keys["Prompt"]]["payload"]["template_string"] == \
        "$quality, $race, $hair, $outfit, $place, $light"
    assert any('"$hair"' in w for w in changed[keys["Prompt"]]["warnings"])
    tested = pack_tidy.runs(plan, new)
    for t in tested:
        chunks = [c.strip() for c in t["prompt"].split(",")]
        assert len(chunks) == len(set(chunks))


def test_a_rule_on_the_model_keeps_its_words_and_its_read():
    """9B pack 11 (2026-10-26): the test runs set no model, so $quality
    showed its otherwise, which a Flux preset also said; the tidy took
    $quality out of the template, and Pony lost its score tags."""
    raw = _raw()
    raw["items"].insert(0, _item(kind="derivation", name="Model quality", var="quality",
                                 about="q"))
    raw["items"].insert(1, _item(kind="fixed_values", name="Flux Quality", var="flux_q",
                                 about="f"))
    raw["items"][-1]["about"] = "$quality, $race, $hair, $outfit, $place, $light, $flux_q"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    keys = _keys(plan)
    built[keys["Model quality"]] = {"id": plan["items"][0]["id"], "payload": {"rules": [{
        "id": "r1", "branches": [{
            "condition": {"var": "model_variant", "op": "equals", "value": "pony"},
            "action": {"target_var": "quality", "mode": "replace",
                       "value": "score_9, score_8_up"}}],
        "else": {"action": {"target_var": "quality", "mode": "replace",
                            "value": "masterpiece, best quality"}}}]}}
    built[keys["Flux Quality"]] = {"id": plan["items"][1]["id"], "payload": {"values": [
        {"id": "v1", "name": "flux_q", "value": "masterpiece, best quality"}]}}
    built[keys["Prompt"]]["payload"]["template_string"] = raw["items"][-1]["about"]
    new, changed = pack_tidy.tidy(plan, built)
    assert "$quality" in new[keys["Prompt"]]["payload"]["template_string"]
    assert new[keys["Model quality"]]["payload"] == built[keys["Model quality"]]["payload"]
    assert new[keys["Flux Quality"]]["payload"] == built[keys["Flux Quality"]]["payload"]
    assert keys["Prompt"] not in changed


def _shoes_pack(sundress_tags):
    """Outfit (accepts SHOES) → Shoes (classify SHOES), one agree matrix."""
    plan = {"items": [
        {"key": "o", "kind": "wildcard", "var": "outfit", "name": "Outfit"},
        {"key": "s", "kind": "wildcard", "var": "shoes", "name": "Shoes"},
        {"key": "c", "kind": "constraint", "var": "", "name": "Outfit → Shoes",
         "source": "outfit", "target": "shoes"}]}
    shoes = ["sandals", "heels", "boots"]
    built = {
        "o": {"payload": {"var_binding": "outfit", "sub_categories": shoes,
                          "tag_groups": {"SHOES": shoes}, "tag_group_kinds": {"SHOES": "accepts"},
                          "options": [{"id": "o1", "value": "sundress",
                                       "sub_categories": sundress_tags},
                                      {"id": "o2", "value": "parka",
                                       "sub_categories": ["boots"]}]}},
        "s": {"payload": {"var_binding": "shoes", "sub_categories": shoes,
                          "tag_groups": {"SHOES": shoes},
                          "options": [{"id": f"s{n}", "value": t, "sub_categories": [t]}
                                      for n, t in enumerate(shoes)]}},
        "c": {"payload": {"matrix": {a: {b: {"mode": "allow" if a == b else "exclude"}
                                         for b in shoes} for a in shoes},
                          "exceptions": []}},
    }
    return plan, built


def test_an_outfit_that_accepts_two_shoes_is_no_dead_end():
    # The engine rolls ONE accepted shoe per pick, so a sundress that accepts
    # sandals and heels always has a shoe; scoring both tags at once used to
    # add an empty Shoes option that left prompts with no shoes.
    plan, built = _shoes_pack(["sandals", "heels"])
    assert pack_tidy.dead_ends(plan, built) == {}
    new, said = pack_tidy.fill_dead_ends(plan, built)
    assert said == {} and new is built
    # A shoe the rule allows for no rolled tag is still a dead end.
    plan, built = _shoes_pack(["sandals", "heels"])
    built["s"]["payload"]["options"] = [o for o in built["s"]["payload"]["options"]
                                        if o["value"] != "heels"]
    assert set(pack_tidy.dead_ends(plan, built)) == {"s"}
    assert '"sundress"' in pack_tidy.dead_ends(plan, built)["s"]
