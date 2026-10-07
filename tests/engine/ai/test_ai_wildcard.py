"""engine/ai/wildcard.py — the model's answer becomes insertable options."""
from __future__ import annotations

import pytest

from engine.ai import wildcard as w

EXISTING = {
    "options": [
        {"id": "a1", "value": "red hair", "weight": 1, "sub_categories": ["warm"]},
        {"id": "a2", "value": "", "weight": 1},  # half-typed editor row
    ],
    "sub_categories": ["warm", "cool"],
}


def _opt(text, weight=1, tags=(), negative=""):
    return {"text": text, "weight": weight, "tags": list(tags), "negative": negative}


def test_basic_options_come_through():
    out = w.compile_options({"options": [_opt("blue hair", tags=["cool"])]},
                            existing_payload=EXISTING)
    assert out["options"] == [{"value": "blue hair", "weight": 1, "tags": ["cool"],
                               "negative": ""}]
    assert out["new_tags"] == []
    assert out["skipped"] == []


def test_duplicates_of_existing_and_each_other_are_skipped():
    out = w.compile_options({"options": [
        _opt("Red  Hair,"), _opt("green hair"), _opt("green hair"),
    ]}, existing_payload=EXISTING)
    assert [o["value"] for o in out["options"]] == ["green hair"]
    assert [s["reason"] for s in out["skipped"]] == ["duplicate", "duplicate"]


@pytest.mark.parametrize("text", ["$color hair", "@{abcd1234} hair", "{a|b} hair"])
def test_extension_syntax_is_refused(text):
    out = w.compile_options({"options": [_opt(text)]}, existing_payload=EXISTING)
    assert out["options"] == []
    assert out["skipped"][0]["reason"].startswith("uses")


def test_tags_are_reshaped_and_reuse_existing_spelling():
    out = w.compile_options({"options": [
        _opt("pink hair", tags=["Warm", "pastel tone", "#bright", "and", "a(b)"]),
    ]}, existing_payload=EXISTING)
    assert out["options"][0]["tags"] == ["warm", "pastel_tone", "bright", "ab"]
    assert out["new_tags"] == ["pastel_tone", "bright", "ab"]


@pytest.mark.parametrize("weight, expected", [
    (2, 2), (0.5, 0.5), (-1, 1), (1000, 1), ("3", 1), (True, 1), (float("nan"), 1),
])
def test_weights_are_kept_sane(weight, expected):
    out = w.compile_options({"options": [_opt("x hair", weight=weight)]},
                            existing_payload=EXISTING)
    assert out["options"][0]["weight"] == expected


def test_limit_and_reporting():
    out = w.compile_options({"options": [_opt(f"hair {i}") for i in range(5)]},
                            existing_payload=EXISTING, limit=3)
    assert len(out["options"]) == 3
    assert [s["reason"] for s in out["skipped"]] == ["more than you asked for"] * 2


def test_negative_kept_and_cleaned():
    out = w.compile_options({"options": [
        _opt("wet hair", negative="  dry,\n frizzy "), _opt("odd hair", negative="$x"),
    ]}, existing_payload=EXISTING)
    assert out["options"][0]["negative"] == "dry, frizzy"
    assert out["options"][1]["negative"] == ""


def test_wrong_shape_raises():
    with pytest.raises(ValueError):
        w.compile_options({"items": []}, existing_payload=EXISTING)
    with pytest.raises(ValueError):
        w.compile_options(["a"], existing_payload=EXISTING)


def test_empty_and_non_string_entries_are_ignored():
    out = w.compile_options({"options": [_opt("   "), {"text": 5}, "x", _opt("ok hair")]},
                            existing_payload=EXISTING)
    assert [o["value"] for o in out["options"]] == ["ok hair"]


def test_prompt_lists_existing_options_tags_and_request():
    text = w.build_user_prompt(
        instruction="more pastel colours", count=7, name="hair", var_binding="hair",
        existing_options=["red hair", "blue hair"], tags=["warm", "cool", "misc"],
        axes={"TONE": ["warm", "cool"]},
    )
    assert "Variable: $hair" in text
    assert "Tag group TONE: warm, cool" in text
    assert "Other tags: misc" in text
    assert "- red hair" in text
    assert "Request: more pastel colours" in text
    assert "Write 7 new options." in text


def test_prompt_caps_examples():
    text = w.build_user_prompt(
        instruction="x", count=1, name="n", var_binding="", tags=[],
        existing_options=[f"opt {i}" for i in range(100)],
    )
    assert "- opt 59" in text
    assert "- opt 60" not in text
    assert "and 40 more" in text


def test_schema_is_openai_strict_compatible():
    item = w.OPTIONS_SCHEMA["properties"]["options"]["items"]
    assert set(item["required"]) == set(item["properties"])
    assert item["additionalProperties"] is False
