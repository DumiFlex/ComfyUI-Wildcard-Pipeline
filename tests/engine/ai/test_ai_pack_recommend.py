"""engine/ai/pack/recommend.py — the pack settings a request, the
assistant's model and the chat's plan card recommend."""
from __future__ import annotations

from engine.ai import chat, guide
from engine.ai.pack import recommend


def _rec(text, cfg=None, suggested=None):
    return recommend.recommend(text, cfg, suggested)


def test_two_families_mean_per_family_and_mixed_styles_stay_auto():
    got = _rec("a girl pack that works on Pony and Flux")
    assert got["settings"] == {"model": "family", "style": "auto", "negatives": "auto"}
    assert got["reasons"]["model"] == "the request names Pony and Flux"
    assert got["reasons"]["negatives"] == "Pony reads a negative prompt"


def test_one_family_sets_the_style_and_negatives_it_reads():
    flux = _rec("flux portraits of a knight")["settings"]
    assert flux == {"model": "any", "style": "sentences", "negatives": "none"}
    ill = _rec("Illustrious XL anime girls")["settings"]
    # "XL" next to Illustrious is not SDXL as well.
    assert ill == {"model": "any", "style": "tags", "negatives": "auto"}


def test_words_that_only_look_like_a_family_name_none():
    assert guide.families_in("a ponytail and a chromatic dress") == []
    assert _rec("a ponytail and a chromatic dress")["settings"] == {}


def test_request_words_for_rating_library_structure_count_and_style():
    got = _rec("an nsfw pack from my wildcards, one bundle, 12 options each, danbooru tags")
    assert got["settings"] == {"style": "tags", "rating": "nsfw", "library": "reuse",
                               "structure": "flat", "count": 12}
    assert got["reasons"]["rating"] == 'the request says "nsfw"'
    assert _rec("a sfw cafe pack")["settings"] == {"rating": "safe"}
    assert _rec("a cafe pack, not sfw")["settings"] == {"rating": "nsfw"}


def test_the_assistant_model_gives_planner_and_drafts():
    got = _rec("cafe pack", {"model": "qwen3.5-9b", "local": True})
    assert got["settings"] == {"planner": "graph", "drafts": "auto"}
    assert "is small" in got["reasons"]["planner"]


def test_the_chat_fills_and_overrides_request_settings_only():
    got = _rec("flux portraits", {"model": "m", "local": False},
               {"style": "Tags", "planner": "items", "youth_negative": "off",
                "rating": "spicy", "count": 200, "library": "reuse"})
    assert got["settings"]["style"] == "tags"
    assert got["reasons"]["style"] == "suggested in the chat"
    assert got["settings"]["library"] == "reuse"
    assert got["settings"]["count"] == 60
    # Planner, drafts and the youth negative never come from the chat; an
    # unknown value is dropped.
    assert got["settings"]["planner"] == "graph"
    assert "youth_negative" not in got["settings"]
    assert "rating" not in got["settings"]


def test_plan_pack_carries_the_chat_settings_onto_its_card():
    lib = chat.Library([], [], [])
    out = lib.run("plan_pack", {"description": "Pony and Flux character pack",
                                "settings": {"model": "family", "style": "bogus"}})
    assert out["op"]["settings"] == {"model": "family"}
    assert out["preview"][-1] == "Suggested settings: Per model family"
    plain = lib.run("plan_pack", {"description": "Medieval fantasy character pack"})
    assert "settings" not in plain["op"]
    assert len(plain["preview"]) == 1
