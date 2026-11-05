"""engine/ai/wildcard_edit.py — checking the model's edits to existing options."""
from __future__ import annotations

import pytest

from engine.ai import wildcard_edit as ed

OPTS = [
    {"id": "1", "value": "red cloak", "weight": 1, "sub_categories": ["winter"]},
    {"id": "2", "value": "hoodie, jeans", "weight": 1, "sub_categories": []},
    {"id": "3", "value": "linen tunic", "weight": 2, "sub_categories": ["summer"]},
]
REG = ["winter", "summer"]


def test_every_action_has_a_strict_schema():
    for action in ed.ACTIONS:
        schema = ed.SCHEMAS[action]
        assert schema["additionalProperties"] is False
        item = next(iter(schema["properties"].values()))["items"]
        assert set(item["required"]) == set(item["properties"])
        assert item["additionalProperties"] is False


def test_prompt_numbers_options_and_shows_weights_and_tags():
    p = ed.build_edit_prompt(action="retag", instruction="tag by season", name="outfit",
                             var_binding="outfit", options=OPTS, tags=REG)
    assert "1. red cloak  [tags winter]" in p
    assert "3. linen tunic  [weight 2; tags summer]" in p
    assert p.endswith("Request: tag by season")


def test_remove_keeps_reasons_and_ignores_unknown_and_repeated_ids():
    out = ed.compile_edit("remove", {"remove": [
        {"id": "2", "reason": "  modern\n clothes "}, {"id": "2", "reason": "again"},
        {"id": "7", "reason": "?"}, {"id": 1, "reason": "numeric id"},
    ]}, options=OPTS, registry=REG)
    assert [(c["id"], c["reason"]) for c in out["changes"]] == [
        ("2", "modern clothes"), ("1", "numeric id"),
    ]
    assert all(c["after"] is None for c in out["changes"])
    assert out["skipped"] == [{"text": "7", "reason": "not an option in the list"}]


def test_rewrite_refuses_syntax_and_collisions_and_drops_no_ops():
    out = ed.compile_edit("rewrite", {"options": [
        {"id": "1", "text": "red cloak"},             # unchanged
        {"id": "2", "text": "a $var hoodie"},         # syntax
        {"id": "3", "text": "Red  cloak"},            # same as option 1
    ]}, options=OPTS, registry=REG)
    assert out["changes"] == []
    assert [s["reason"] for s in out["skipped"]] == [
        "an option can't read $variables (a wildcard sets one); join variables in a "
        "combine or a derivation instead (write $$ for a literal $)",
        "same as another option",
    ]


def test_rewrite_lets_two_options_swap_wording_in_order():
    out = ed.compile_edit("rewrite", {"options": [
        {"id": "1", "text": "crimson cloak"}, {"id": "2", "text": "red cloak"},
    ]}, options=OPTS, registry=REG)
    assert [c["after"]["value"] for c in out["changes"]] == ["crimson cloak", "red cloak"]


def test_retag_reuses_existing_spelling_and_reports_new_tags():
    out = ed.compile_edit("retag", {"options": [
        {"id": "2", "tags": ["Winter", "street wear", "bad,tag"]},
        {"id": "1", "tags": ["winter"]},  # no change
    ]}, options=OPTS, registry=REG)
    assert out["changes"] == [{
        "id": "2", "before": {"tags": []},
        "after": {"tags": ["winter", "street_wear", "badtag"]},
    }]
    assert out["new_tags"] == ["street_wear", "badtag"]


def test_reweight_skips_out_of_range_and_unchanged():
    out = ed.compile_edit("reweight", {"options": [
        {"id": "1", "weight": 0.5}, {"id": "2", "weight": 500}, {"id": "3", "weight": 2},
    ]}, options=OPTS, registry=REG)
    assert out["changes"] == [{"id": "1", "before": {"weight": 1}, "after": {"weight": 0.5}}]
    assert out["skipped"][0]["reason"] == "weight out of range"


def test_wrong_shape_raises():
    with pytest.raises(ValueError):
        ed.compile_edit("remove", {"options": []}, options=OPTS, registry=REG)
    with pytest.raises(ValueError):
        ed.compile_edit("nope", {}, options=OPTS, registry=REG)


def test_ids_are_integer_choices_for_small_models():
    """The 9B under LM Studio's grammar wrote "", "},{" or prose into a
    string id; as an integer enum it named the right options."""
    s = ed.schema_for("remove", ["1", "2", "3"])
    item = s["properties"]["remove"]["items"]
    assert item["properties"]["id"] == {"type": "integer", "enum": [1, 2, 3]}
    assert item["required"] == ["id", "reason"]
    assert ed.schema_for("reweight", ["a1"]) == ed.SCHEMAS["reweight"]
    from engine.ai import organize
    o = organize.schema_for(["1", "2"])["properties"]["items"]["items"]
    assert o["properties"]["id"] == {"type": "integer", "enum": [1, 2]}
    assert organize.SCHEMA["properties"]["items"]["items"]["properties"]["id"] == {
        "type": "string"}


def test_rewrite_drops_the_note_the_prompt_puts_after_an_option():
    out = ed.compile_edit("rewrite", {"options": [
        {"id": 1, "text": "crimson cloak  [weight 2; tags playful]"},
        {"id": "2", "text": "blue hoodie [tags playful]"},
    ]}, options=OPTS, registry=REG)
    assert [c["after"]["value"] for c in out["changes"]] == ["crimson cloak", "blue hoodie"]


def test_retag_leaves_the_wildcards_own_library_tags_off_options():
    # Re-test on 367a6a5 (9B): the wildcard's library tag "axis" went on
    # every option.
    opts = [{"id": "1", "value": "smirk", "weight": 1, "sub_categories": []}]
    out = ed.compile_edit("retag", {"options": [{"id": 1, "tags": ["axis", "playful"]}]},
                               options=opts, registry=["playful"], labels=["axis", "face"])
    assert out["changes"][0]["after"]["tags"] == ["playful"]
    assert any("library tag" in s["reason"] for s in out["skipped"])
    # A label that is also an option tag stays.
    both = ed.compile_edit("retag", {"options": [{"id": 1, "tags": ["axis"]}]},
                                options=opts, registry=["axis"], labels=["axis"])
    assert both["changes"][0]["after"]["tags"] == ["axis"]


def test_an_empty_answer_carries_the_models_reason():
    # Panel eval 2026-10-21: "tag each option with one mood" came back as
    # [] three times out of three on Haiku and the 9B, and the user could
    # not tell a judgement from a miss.
    assert "note" in ed.SCHEMAS["retag"]["properties"]
    assert "note" in ed.schema_for("retag", ["1", "2"])["properties"]
    assert 'say why in "note"' in ed.system_prompt("retag")
    opts = [{"id": "1", "value": "smile", "weight": 1, "sub_categories": ["happy"]}]
    out = ed.compile_edit("retag", {"options": [], "note": "  every option already\ncarries "
                                    "one of those mood tags  "}, options=opts, registry=["happy"])
    assert out["changes"] == [] and out["note"] == "every option already carries one of those " \
                                                   "mood tags"
    # With changes the note is dropped: it only explains an empty list.
    out = ed.compile_edit("retag", {"options": [{"id": 1, "tags": ["calm"]}], "note": "x"},
                          options=opts, registry=["happy"])
    assert out["changes"] and out["note"] == ""
    out = ed.compile_edit("retag", {"options": []}, options=opts, registry=["happy"])
    assert out["note"] == ""
    # An empty answer with a reason is a judgement, so "each" doesn't re-ask it.
    ask = "tag each option with one mood"
    assert ed.answered_nothing("retag", {"options": []}, ask)
    assert not ed.answered_nothing("retag", {"options": [], "note": "all tagged already"}, ask)
    assert ed.answered_nothing("retag", {"options": [], "note": "  "}, ask)


# ── bench 2026-10-26 (9B manual runs) ───────────────────────────────────────


def test_a_retag_that_adds_keeps_the_options_tags():
    # W17: "add an intensity tag" came back as the new tag alone.
    out = ed.compile_edit("retag", {"options": [
        {"id": "1", "tags": ["mild"]}, {"id": "3", "tags": ["strong", "summer"]},
    ]}, options=OPTS, registry=REG,
        instruction="add an intensity tag to every option: mild or strong")
    assert [c["after"]["tags"] for c in out["changes"]] == [
        ["winter", "mild"], ["summer", "strong"]]


def test_a_retag_that_sets_still_replaces():
    out = ed.compile_edit("retag", {"options": [{"id": "1", "tags": ["summer"]}]},
                          options=OPTS, registry=REG,
                          instruction="change the winter ones to summer")
    assert out["changes"][0]["after"]["tags"] == ["summer"]
    assert not ed.adds_tags("replace the tags, add season ones only")


def test_half_as_likely_halves_the_current_weight():
    # W12: a 0.1 option was set to 0.5, five times more likely.
    opts = [{"id": "1", "value": "wool coat", "weight": 0.1, "sub_categories": []},
            {"id": "2", "value": "business suit", "weight": 1, "sub_categories": []},
            {"id": "3", "value": "gown", "weight": 4, "sub_categories": []}]
    out = ed.compile_edit("reweight", {"options": [
        {"id": "1", "weight": 0.5}, {"id": "2", "weight": 0.5}, {"id": "3", "weight": 2},
    ]}, options=opts, registry=[], instruction="make formal and evening wear half as likely")
    assert [(c["id"], c["after"]["weight"]) for c in out["changes"]] == [
        ("1", 0.05), ("2", 0.5), ("3", 2)]


def test_a_weight_that_moves_the_wrong_way_is_refused():
    opts = [{"id": "1", "value": "wool coat", "weight": 0.1, "sub_categories": []}]
    out = ed.compile_edit("reweight", {"options": [{"id": "1", "weight": 0.3}]},
                          options=opts, registry=[], instruction="make the coats rarer")
    assert out["changes"] == []
    assert "rarer" in out["skipped"][0]["reason"]


def test_a_weight_note_copied_as_a_tag_is_dropped():
    # W11: the prompt's "[weight 0.1; …]" came back as tag "weight_0.1".
    out = ed.compile_edit("retag", {"options": [{"id": "2", "tags": ["weight_0.1", "spring"]}]},
                          options=OPTS, registry=REG)
    assert out["changes"][0]["after"]["tags"] == ["spring"]


def test_the_reweight_guide_says_relative_asks_change_the_current_weight():
    assert "CURRENT" in ed.system_prompt("reweight")
    assert "0.5 is half as likely" not in ed.system_prompt("reweight")
