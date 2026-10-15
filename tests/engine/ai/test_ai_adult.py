"""Adult packs: youth words are left out and the negative gets its block."""
from __future__ import annotations

import pytest

from engine.ai import adult, guide, pack
from tests.engine.ai.test_ai_pack_v2 import _raw


def test_youth_words_are_whole_words_and_ages_under_18():
    assert adult.youth_words("school uniform, 1girl") == ["school uniform"]
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


def test_an_nsfw_pack_leaves_out_youth_options_and_guards_the_negative():
    plan = _nsfw_plan()
    out = pack.compile_item(plan, _key(plan, "Hair"), {}, {"axes": [], "null_weight": 0,
                                                            "options": [
        {"text": "long hair", "weight": 1, "tags": [], "negative": "", "fallback": False},
        {"text": "school uniform twintails", "weight": 1, "tags": [], "negative": "",
         "fallback": False}]})
    assert [o["value"] for o in out["payload"]["options"]] == ["long hair"]
    assert any("an adult pack never names a minor (school uniform)" in w
               for w in out["warnings"])
    with pytest.raises(ValueError):
        pack.compile_item(plan, _key(plan, "Hair"), {}, {"axes": [], "null_weight": 0,
                                                          "options": [
            {"text": "loli", "weight": 1, "tags": [], "negative": "", "fallback": False}]})
    tpl = pack.compile_item(plan, _key(plan, "Prompt"), {}, {
        "template": "$race, $hair, $outfit, $place, $light", "negative": "lowres, $negatives"})
    assert "loli" in tpl["payload"]["negative_template"]
    assert any("rated nsfw" in w for w in tpl["warnings"])
    # A safe pack is left as it is.
    safe = pack.compile_plan(_raw())
    tpl = pack.compile_item(safe, _key(safe, "Prompt"), {}, {
        "template": "$race, $hair, $outfit, $place, $light", "negative": "lowres, $negatives"})
    assert "loli" not in tpl["payload"]["negative_template"]


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
