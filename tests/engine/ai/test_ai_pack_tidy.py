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
