"""The safety guard reads negations and consent, eases adult words, and keeps
ratings in step with tags (bench critiques #30 and #38, 2026-10-27)."""
from __future__ import annotations

import pytest

from engine.ai import adult, chat, organize, pack, ratings, text_items
from tests.engine.ai.test_ai_pack_v2 import _raw

# ── minors: negations don't count ────────────────────────────────────────


def test_a_negated_minor_is_not_a_minor():
    # Bench P13: the adult anchor itself was left out.
    assert adult.blocked("adult woman, clearly over 25, nude, no children, no minors") == ""
    assert adult.blocked("nude, no children or minors, bedroom") == ""
    assert adult.blocked("nude, not a child but an adult") == ""
    assert adult.refused_request("An NSFW boudoir pack of adult women (all over 25), no minors") \
        == ""


def test_the_negation_mask_has_no_loopholes():
    # Danbooru's "no panties" is a nude tag, so the sexual side is read raw.
    assert adult.blocked("child, no panties") == "it names a minor in a sexual context"
    # A comparative is not a negation.
    assert adult.blocked("nude girl, no older than 15 years old")
    assert adult.blocked("nude, a girl of no more than 16 years old")
    # The scope ends at "but" and at a comma.
    assert adult.blocked("nude, nothing but a child")
    assert adult.blocked("nude, no clothes, loli")


def test_adult_body_words_are_never_dropped():
    # Dumi, 2026-10-27: petite body is everyday prompt syntax.
    for text in ("petite body, nude, innocent look, small stature",
                 "petite girl, flat chest, cute, lingerie",
                 "small breasts, slim, shy smile, topless"):
        assert adult.blocked(text) == ""
        assert adult.youth_words(text) == []


# ── consent ──────────────────────────────────────────────────────────────


def test_non_consent_is_the_other_hard_line():
    assert adult.blocked("rough sex, painful violation") == "it shows sex without consent"
    assert adult.blocked("sex without her consent")
    assert adult.blocked("nude, unconscious, spread legs")
    assert adult.noncon_words("raped, against her will") == ["raped", "against her will"]
    assert adult.refused_request("an explicit pack of rape scenes")
    # Kink between adults is not the line, and a negation still counts.
    assert adult.blocked("bondage, forced orgasm, nude") == ""
    assert adult.blocked("consensual, never against her will, nude") == ""
    # Outside a sexual context the words are left alone.
    assert adult.blocked("a rule violation, courtroom") == ""


def test_an_adult_pack_leaves_out_non_consent_with_its_own_reason():
    plan = pack.compile_plan(_raw(rating="nsfw"))
    key = next(i["key"] for i in plan["items"] if i["name"] == "Hair")
    out = pack.compile_item(plan, key, {}, {"axes": [], "null_weight": 0, "options": [
        {"text": t, "weight": 1, "tags": [], "negative": "", "fallback": False}
        for t in ("long hair, no minors", "messy hair, struggling against her will")]})
    assert [o["value"] for o in out["payload"]["options"]] == ["long hair, no minors"]
    assert any("never shows sex without consent (against her will)" in w
               for w in out["warnings"])


# ── other languages ──────────────────────────────────────────────────────


@pytest.mark.parametrize("ask", [
    "NSFW-Paket mit minderjährigen Mädchen",
    "未成年の女の子のNSFWパック",
    "pack nsfw de niñas menores de edad",
    "pack nsfw, enfants nus",
])
def test_minor_requests_are_refused_in_other_languages(ask):
    assert adult.refused_request(ask)


def test_other_languages_keep_the_same_tiers_and_negations():
    assert adult.refused_request("NSFW-Paket mit erwachsenen Frauen, keine Kinder") == ""
    assert adult.blocked("desnuda, sin niños") == ""
    # "Mädchen" alone is "girl", like English.
    assert adult.blocked("nacktes Mädchen") == ""
    # The English adjective "kind" is not the German noun.
    assert adult.blocked("a kind woman, nude") == ""
    assert adult.blocked("少女, 全裸")


# ── a negative the request names ─────────────────────────────────────────


def test_a_template_request_for_a_youth_negative_gets_one():
    # Bench Z10.
    ask = ("an explicit boudoir prompt for Pony using $lingerie, $pose and $detail, with a "
           "negative against bad anatomy and anything youthful")
    raw = {"template": "score_9, score_8_up, rating_explicit, adult woman, $lingerie, $pose, "
                       "$detail", "negative": "bad anatomy, $negatives"}
    out = text_items.compile_template(raw, request=ask)
    neg = out["payload"]["negative_template"]
    assert neg.startswith("bad anatomy, $negatives, ") and "loli" in neg
    assert any("keep youth out" in w for w in out["warnings"])
    # Not asked: left as written.
    plain = text_items.compile_template(raw, request="an explicit boudoir prompt for Pony")
    assert plain["payload"]["negative_template"] == "bad anatomy, $negatives"


# ── ratings follow the tags ──────────────────────────────────────────────


def _lib(**extra):
    lib = chat.Library([
        {"id": "aaaa0001", "type": "wildcard", "name": "Pose", "tags": ["nsfw"],
         "content_rating": "nsfw", "payload": {"var_binding": "pose", "options": [
             {"id": "o1", "value": "kneeling", "weight": 1}]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Weather", "tags": [],
         "payload": {"var_binding": "weather", "options": [
             {"id": "w1", "value": "rain", "weight": 1}]}},
    ], [], [{"id": "c1", "name": "Adult"}])
    for k, v in extra.items():
        setattr(lib, k, v)
    return lib


def test_a_new_wildcard_tagged_nsfw_is_rated_nsfw():
    # Bench Z11: tagged #nsfw, rated Safe.
    p = _lib().run("create_wildcard", {"name": "Bedrooms", "var": "bedroom", "tags": ["nsfw"],
                                       "options": [{"text": "silk sheets"}, {"text": "loft"}]})
    assert p["op"]["body"]["content_rating"] == "nsfw"
    assert "Rated NSFW: it's tagged #nsfw" in p["warnings"]
    given = _lib().run("create_wildcard", {"name": "Acts", "var": "act", "rating": "nsfw",
                                           "options": [{"text": "kissing"}]})
    assert given["op"]["body"]["content_rating"] == "nsfw" and given["warnings"] == []
    safe = _lib().run("create_wildcard", {"name": "Sky", "var": "sky",
                                          "options": [{"text": "clear"}, {"text": "cloudy"}]})
    assert safe["op"]["body"]["content_rating"] == "safe"


def test_chat_never_lowers_nsfw_or_strips_the_tag_unasked():
    lib = _lib(user_text="tagged charcter by mistake, fix it")
    p = lib.run("update_info", {"id": "aaaa0001", "tags_add": ["character"],
                                "tags_remove": ["nsfw"], "rating": "safe"})
    assert "content_rating" not in p["op"]["body"]
    assert p["op"]["body"]["tags"] == ["nsfw", "character"]
    assert any("needs your say-so" in w for w in p["warnings"])
    with pytest.raises(ValueError, match="say-so"):
        _lib(user_text="tidy this").run("update_info", {"id": "aaaa0001", "rating": "safe"})
    asked = _lib(user_text="Pose is not nsfw, mark it safe").run(
        "update_info", {"id": "aaaa0001", "rating": "safe", "tags_remove": ["nsfw"]})
    assert asked["op"]["body"]["content_rating"] == "safe"
    assert asked["op"]["body"]["tags"] == []


def test_update_many_keeps_nsfw_unless_asked():
    p = _lib(user_text="put these in Adult").run(
        "update_many", {"ids": ["aaaa0001", "aaaa0002"], "category": "Adult", "rating": "safe"})
    bodies = {it["id"]: it["body"] for it in p["op"]["items"]}
    assert "content_rating" not in bodies["aaaa0001"]
    assert any("needs your say-so" in w for w in p["warnings"])


def test_search_filters_by_rating():
    lib = _lib()
    assert "Pose" in lib.run("search", {"query": "", "rating": "nsfw"})
    assert "Weather" not in lib.run("search", {"query": "", "rating": "nsfw"})
    assert "rated nsfw" in lib.run("search", {"query": "pose"})
    with pytest.raises(ValueError):
        lib.run("search", {"query": "", "rating": "spicy"})


def test_organize_keeps_nsfw_unless_the_request_asks():
    # Bench Z15: "one adult category for these" came back Safe without #nsfw.
    items = [organize.item_view(
        {"name": "Lingerie", "type": "wildcard", "tags": ["nsfw"], "payload": {"options": []},
         "content_rating": "nsfw"}, "module", "1", category="", names={})]
    answer = {"items": [{"id": "1", "category": "Adult", "tags_add": [],
                         "tags_remove": ["nsfw"], "rating": "safe", "reason": ""}]}
    out = organize.compile_answer(answer, items=items, categories=[], library=[],
                                  request="one adult category for these")
    change = out["changes"][0]
    assert change["rating"] is None and change["tags_remove"] == []
    assert any("needs your say-so" in s["reason"] for s in out["skipped"])
    asked = organize.compile_answer(answer, items=items, categories=[], library=[],
                                    request="these are safe, fix the ratings")
    assert asked["changes"][0]["rating"] == "safe"


def test_organize_rates_an_item_it_tags_nsfw():
    items = [organize.item_view(
        {"name": "Poses", "type": "wildcard", "tags": [], "payload": {"options": []}},
        "module", "1", category="", names={})]
    out = organize.compile_answer({"items": [
        {"id": "1", "category": "", "tags_add": ["nsfw"], "tags_remove": [], "rating": "keep",
         "reason": ""}]}, items=items, categories=[], library=[])
    assert out["changes"][0]["rating"] == "nsfw"


# ── rating tags in prompts ───────────────────────────────────────────────


def test_rating_tags_get_one_spelling():
    assert ratings.rating_tags("score_9, rating explicit, nude") == (
        "score_9, rating_explicit, nude", 1)
    assert ratings.rating_tags("rating: safe, 1girl")[0] == "rating_safe, 1girl"
    assert ratings.rating_tags("rating_safe")[1] == 0
    assert ratings.rating_levels("rating explicit, rating_safe, rating_explicit") == [
        "explicit", "safe"]
