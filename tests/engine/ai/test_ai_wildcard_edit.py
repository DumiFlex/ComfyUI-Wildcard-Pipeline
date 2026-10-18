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
