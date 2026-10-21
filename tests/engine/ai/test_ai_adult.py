"""Adult packs: minors are left out, costume words flagged, the negative is a setting."""
from __future__ import annotations

import pytest

from engine.ai import adult, guide, pack
from tests.engine.ai.test_ai_pack_v2 import _raw


def test_youth_words_are_whole_words_and_ages_under_18():
    assert adult.youth_words("school uniform, 1girl") == ["school uniform"]
    assert adult.minor_words("school uniform, teen, younger sister, 1girl") == []
    assert adult.minor_words("a loli, 16 years old, 19 years old") == ["loli", "16 years old"]
    assert adult.youth_words("a loli, petite child") == ["loli", "child"]
    assert adult.youth_words("16 years old") == ["16 years old"]
    assert adult.youth_words("25 years old, mature female, petite, kidney beans, wild") == []
    assert adult.youth_words("teenage, young girl, middle_school") == [
        "teenage", "young girl", "middle_school"]


def test_youth_negative_adds_only_what_is_missing():
    neg, added = adult.with_youth_negative("lowres, child, $negatives", "tags")
    assert "child" not in added and "loli" in added
    assert neg.startswith("lowres, child, $negatives, loli")
    assert adult.with_youth_negative(neg, "tags") == (neg, [])
    neg, _ = adult.with_youth_negative("", "sentences")
    assert neg.split(", ")[:2] == ["child", "minor"]


def _nsfw_plan():
    return pack.compile_plan(_raw(rating="nsfw"))


def _key(plan, name):
    return next(i["key"] for i in plan["items"] if i["name"] == name)


def _hair(plan, *texts):
    return pack.compile_item(plan, _key(plan, "Hair"), {}, {"axes": [], "null_weight": 0,
                                                            "options": [
        {"text": t, "weight": 1, "tags": [], "negative": "", "fallback": False}
        for t in texts]})


def _prompt(plan):
    return pack.compile_item(plan, _key(plan, "Prompt"), {}, {
        "template": "$race, $hair, $outfit, $place, $light", "negative": "lowres, $negatives"})


def test_an_nsfw_pack_leaves_out_minors_and_flags_costume_words():
    plan = _nsfw_plan()
    out = _hair(plan, "long hair", "school uniform twintails", "loli twintails")
    # A clearly minor word is left out; a costume an adult can wear stays,
    # with a warning for the user to judge.
    assert [o["value"] for o in out["payload"]["options"]] == [
        "long hair", "school uniform twintails"]
    assert any("an adult pack never names a minor (loli)" in w for w in out["warnings"])
    assert any(w.startswith("Check \"school uniform twintails\"") and "school uniform" in w
               for w in out["warnings"])
    with pytest.raises(ValueError):
        _hair(plan, "loli")
    tpl = _prompt(plan)
    assert "loli" in tpl["payload"]["negative_template"]
    assert any("Youth negative" in w for w in tpl["warnings"])
    # A safe pack is left as it is.
    safe = pack.compile_plan(_raw())
    assert "loli" not in _prompt(safe)["payload"]["negative_template"]
    assert _hair(safe, "school uniform twintails")["warnings"] == []


def test_the_youth_negative_is_a_setting():
    assert pack.parse_settings({})["youth_negative"] == "on"
    plan = _nsfw_plan()
    plan["settings"] = pack.parse_settings({**plan["settings"], "youth_negative": "off"})
    tpl = _prompt(plan)
    assert "loli" not in tpl["payload"]["negative_template"]
    assert not any("Youth negative" in w for w in tpl["warnings"])


def test_item_prompts_carry_the_model_format_and_the_adult_rules():
    plan = pack.compile_plan(_raw(rating="nsfw", model="pony"))
    req = pack.item_request(plan, _key(plan, "Prompt"), {})
    assert "score_9, score_8_up, score_7_up" in req["user"]
    assert "Every character is an adult" in req["user"]
    assert pack.model_lines(plan, "constraint") == ""
    safe = pack.compile_plan(_raw(model="flux"))
    assert "ignores the negative prompt" in pack.item_request(safe, _key(safe, "Prompt"),
                                                              {})["user"]
    assert "adult" not in pack.item_request(safe, _key(safe, "Hair"), {})["user"].lower()


def test_the_planner_gets_the_structure_and_shapes():
    assert guide.STRUCTURE in pack.PLAN_SYSTEM and guide.BLUEPRINTS in pack.PLAN_SYSTEM
    assert guide.STRUCTURE in pack.REVIEW_SYSTEM
    for name, key in [("Pony Diffusion V6 XL", "pony"), ("NoobAI-XL", "noobai"),
                      ("waiIllustriousSDXL", "illustrious"), ("Animagine XL 4.0", "animagine"),
                      ("Anima", "anima"), ("flux1-dev", "flux"), ("Qwen-Image", "qwen_image"),
                      ("z_image_turbo", "lumina2"), ("wan2.2", "wan"), ("sd15", "sd15"),
                      ("juggernautXL", "sdxl"), ("my model", "")]:
        assert guide.family(name) == key, name
    assert set(guide.FORMATS) >= {k for _, k in guide._FAMILY}


def test_no_ai_path_keeps_an_option_that_sexualises_a_minor():
    from engine.ai import derivation, text_items, wildcard, wildcard_edit
    assert adult.sexual_minor("nude, child") and adult.sexual_minor("loli, lingerie")
    assert not adult.sexual_minor("school uniform, classroom")
    assert not adult.sexual_minor("nude, school uniform, mature female")
    assert not adult.sexual_minor("nude, mature female, 25 years old")
    minor = "it names a minor in a sexual context"
    out = wildcard.compile_options({"options": [
        {"text": "nude, 15 years old", "weight": 1, "tags": [], "negative": ""},
        {"text": "school uniform", "weight": 1, "tags": [], "negative": ""}]},
        existing_payload={"options": [], "sub_categories": []})
    assert [o["value"] for o in out["options"]] == ["school uniform"]
    assert out["skipped"][0]["reason"] == minor
    edit = wildcard_edit.compile_edit(
        "rewrite", {"options": [{"id": "1", "text": "loli, nude"}]},
        options=[{"id": "1", "value": "red hair", "weight": 1}], registry=[])
    assert edit["changes"] == [] and edit["skipped"][0]["reason"] == minor
    fixed = text_items.compile_fixed({"values": [
        {"name": "a", "value": "child, naked"}, {"name": "b", "value": "red hair"}]})
    assert [v["name"] for v in fixed["payload"]["values"]] == ["b"]
    for compile_ in (lambda t: text_items.compile_combine({"template": t}, out_var="x"),
                     lambda t: text_items.compile_template({"template": t})):
        with pytest.raises(ValueError, match="minor"):
            compile_("$a, loli, sex")
    rules = derivation.compile_rules({"rules": [{"summary": "s", "branches": [{
        "match": "all", "conditions": [{"var": "a", "op": "exists", "value": ""}],
        "actions": [{"target_var": "b", "mode": "append", "value": "toddler, nude"}]}],
        "else_actions": []}]}, catalog={"a": {}, "b": {}})
    assert rules["rules"] == [] and rules["skipped"][0]["reason"] == minor


def test_young_person_words_count_as_minors_in_a_sexual_context():
    # On their own they are flagged (a 19-year-old "schoolgirl" exists);
    # next to a nude word, or anywhere in an nsfw pack, they name a minor.
    text = "schoolgirl, teenager, little girl, child, school uniform"
    assert adult.minor_words(text) == ["child"]
    assert adult.minor_words(text, sexual=True) == ["schoolgirl", "teenager", "little girl",
                                                    "child"]
    assert adult.youth_words(text)[-1] == "school uniform"
    assert adult.sexual_minor("lingerie, teen") and adult.sexual_minor("sexy schoolgirl")
    assert not adult.sexual_minor("nude, school uniform, mature female")
    assert not adult.sexual_minor("teen heartthrob boyband posters")
    plan = _nsfw_plan()
    out = _hair(plan, "long hair", "school uniform twintails", "schoolgirl twintails")
    assert [o["value"] for o in out["payload"]["options"]] == [
        "long hair", "school uniform twintails"]
    assert any("(schoolgirl)" in w for w in out["warnings"])


def test_a_request_that_sexualises_a_minor_is_refused_before_any_model_call():
    assert adult.refused_request("NSFW pack of underage girls").startswith(
        "This asks for a minor (underage) in a sexual context")
    assert "schoolgirls" in adult.refused_request("sexy schoolgirls, lingerie")
    # A costume, an age of 18 or more, or no sexual cue is not a refusal.
    assert adult.refused_request("adult school uniform pack, nsfw") == ""
    assert adult.refused_request("nude pin-ups, 25 years old, mature woman") == ""
    assert adult.refused_request("school kids on a field trip") == ""


async def test_run_pack_refuses_such_a_request():
    calls = []

    async def complete(**kw):
        calls.append(kw)
        return {}

    with pytest.raises(pack.PlanError, match="asks for a minor"):
        await pack.run_pack(complete, "nsfw pack of underage girls",
                            settings={"planner": "graph"})
    assert calls == []


def test_graph_wired_items_get_the_adult_pass():
    from tests.engine.ai.test_ai_pack_graph import GRAPH
    g = {**GRAPH, "rating": "nsfw", "relations": [], "slots": [
        {"name": "Subject Age", "var": "age", "what": "who", "section": "", "count": 3,
         "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "age", "values": ["schoolgirl", "mature woman", "milf"]}]},
    ], "template": {**GRAPH["template"], "order": ["Quality", "Subject Age"],
                    "negative": "bad anatomy"}}
    plan = pack.compile_graph_plan(g)
    assert plan["rating"] == "nsfw"
    age = next(i["key"] for i in plan["items"] if i["name"] == "Subject Age")
    assert pack.is_wired(plan, age)
    out = pack.wired_payload(plan, age, {})
    assert [o["value"] for o in out["payload"]["options"]] == ["mature woman", "milf"]
    assert any("an adult pack never names a minor (schoolgirl)" in w for w in out["warnings"])
    tpl = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    out = pack.wired_payload(plan, tpl, {})
    assert out["payload"]["negative_template"].startswith("bad anatomy, child, loli")
    assert any("Youth negative" in w for w in out["warnings"])
    # Nothing left: the item fails like a model-written one.
    only = {**g, "slots": [{**g["slots"][0],
                            "axes": [{"name": "age", "values": ["schoolgirl", "teen"]}]}]}
    plan = pack.compile_graph_plan(only)
    with pytest.raises(ValueError, match="every option names a minor"):
        pack.wired_payload(plan, age, {})
    # A safe graph is left alone.
    safe = pack.compile_graph_plan({**g, "rating": "safe"})
    assert pack.wired_payload(safe, tpl, {})["payload"]["negative_template"] == "bad anatomy"


def test_a_graph_built_from_minor_words_loses_them_everywhere():
    # The Huihui run (2026-10-21): an "Age Tier" wildcard of tween / preteen
    # with an age tag group, a rule keyed on the tier, and "mature" in the
    # standing negative. Every one of those goes, not only the options.
    from tests.engine.ai.test_ai_pack_graph import GRAPH
    g = {**GRAPH, "rating": "nsfw", "slots": [
        {"name": "Age Tier", "var": "tier", "what": "age tiers", "section": "", "count": 4,
         "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
         "axes": [{"name": "age", "values": ["tween", "preteen", "mature woman", "milf"]}]},
    ], "relations": [
        {"kind": "derive", "from_slot": "Age Tier", "from_axis": "age", "from_value": "tween",
         "to_slot": "", "to_axis": "", "to_value": "", "factor": 0,
         "var": "girl_type", "text": "petite girl", "otherwise": "curvy woman"},
    ], "template": {**GRAPH["template"], "order": ["Quality", "Age Tier"],
                    "negative": "mature, bad anatomy, mature_female"}}
    plan = pack.compile_graph_plan(g)
    key = {i["name"]: i["key"] for i in plan["items"]}
    tier = pack.wired_payload(plan, key["Age Tier"], {})
    assert [o["value"] for o in tier["payload"]["options"]] == ["mature woman", "milf"]
    assert tier["payload"]["sub_categories"] == ["mature_woman", "milf"]
    assert tier["payload"]["tag_groups"] == {"age": ["mature_woman", "milf"]}
    assert set(tier["payload"]["tag_group_kinds"]) == {"age"}
    rule = next(i["key"] for i in plan["items"] if i["kind"] == "derivation")
    with pytest.raises(ValueError, match="every rule names a minor"):
        pack.wired_payload(plan, rule, {})
    tpl = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    out = pack.wired_payload(plan, tpl, {})
    assert out["payload"]["negative_template"].startswith("bad anatomy, child, loli")
    assert any(w.startswith("Took \"mature, mature_female\" out of the negative")
               for w in out["warnings"])


def test_adult_check_cleans_every_negative_of_an_nsfw_item():
    from engine.ai.pack.adult_pack import adult_check, adult_negative
    assert adult_negative("mature, old photo, milf, adult woman, grown-up") == (
        "old photo, milf", ["mature", "adult woman", "grown-up"])
    assert adult_negative("lowres") == ("lowres", [])
    plan = {"rating": "nsfw", "settings": {}, "style": "tags"}
    wc, said = adult_check("wildcard", {"var_binding": "x", "options": [
        {"id": "a", "value": "nude", "weight": 1, "negative": "clothes, mature"},
        {"id": "b", "value": "dressed", "weight": 1, "negative": "adults"}]}, plan)
    assert [o.get("negative") for o in wc["options"]] == ["clothes", None]
    assert any("out of the negative of \"nude\"" in w for w in said)
    fv, said = adult_check("fixed_values", {"values": [
        {"id": "a", "name": "censor", "value": "uncensored", "negative": "mature, censored"}]},
        plan)
    assert fv["values"][0]["negative"] == "censored"
    rules, said = adult_check("derivation", {"rules": [{"id": "r1", "branches": [
        {"condition": {"var": "age", "op": "equals", "value": "milf"},
         "action": {"target_var": "neg", "mode": "negative", "value": "mature, lowres"}}],
        "else": {"action": {"target_var": "x", "mode": "replace", "value": "ok"}}}]}, plan)
    assert rules["rules"][0]["branches"][0]["action"]["value"] == "lowres"
    assert any("a rule's negative" in w for w in said)
    # A rule keyed on a minor word goes like one that writes it.
    with pytest.raises(ValueError, match="every rule names a minor"):
        adult_check("derivation", {"rules": [{"id": "r1", "branches": [
            {"condition": {"var": "age", "op": "equals", "value": "preteen"},
             "action": {"target_var": "x", "mode": "replace", "value": "small"}}]}]}, plan)
