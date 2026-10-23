"""engine/ai/wildcard.py — the model's answer becomes insertable options."""
from __future__ import annotations

import pytest

from engine.ai import refs
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


def test_an_option_that_only_says_what_to_leave_out_is_skipped():
    out = w.compile_options({"options": [_opt("longsword"), _opt("no guns, no rifles"),
                                         _opt("no hat")]}, existing_payload=EXISTING)
    assert [o["value"] for o in out["options"]] == ["longsword", "no hat"]
    assert "leave out" in out["skipped"][0]["reason"]


def test_duplicates_of_existing_and_each_other_are_skipped():
    out = w.compile_options({"options": [
        _opt("Red  Hair,"), _opt("green hair"), _opt("green hair"),
    ]}, existing_payload=EXISTING)
    assert [o["value"] for o in out["options"]] == ["green hair"]
    assert [s["reason"] for s in out["skipped"]] == ["duplicate", "duplicate"]


@pytest.mark.parametrize("text, why", [
    ("$color hair", "can't read $variables"),
    ("@{abcd1234} hair", "no wildcards to point at"),
    ("a {b hair", "isn't a pick"),
])
def test_unusable_syntax_is_refused_with_a_reason(text, why):
    out = w.compile_options({"options": [_opt(text)]}, existing_payload=EXISTING)
    assert out["options"] == []
    assert why in out["skipped"][0]["reason"]


COLORS = {"id": "c0c0c0c0", "name": "Colors", "type": "wildcard",
          "payload": {"var_binding": "color", "sub_categories": ["warm", "cool"],
                      "options": [{"id": "o1", "value": "red", "sub_categories": ["warm"]}]}}


def test_picks_and_named_refs_compile():
    idx = refs.RefIndex([COLORS])
    out = w.compile_options({"options": [
        _opt("{long|short} hair"), _opt("@{Colors:warm!null} hair", negative="@{colors}"),
        _opt("@{Colors:hot} hair"), _opt("@{Paints} hair"),
    ]}, existing_payload=EXISTING, refs=idx)
    assert [o["value"] for o in out["options"]] == [
        "{long|short} hair", "@{c0c0c0c0#Colors:warm!null} hair"]
    assert out["options"][1]["negative"] == "@{c0c0c0c0#Colors}"
    assert [s["reason"] for s in out["skipped"]] == [
        "Colors has no tag 'hot'; its tags are warm, cool", "no wildcard named 'Paints'"]


def test_a_ref_to_itself_or_back_is_refused():
    idx = refs.RefIndex([COLORS])
    out = w.compile_options({"options": [_opt("@{Colors} hair")]},
                            existing_payload=EXISTING, refs=idx, self_id="c0c0c0c0")
    assert "itself" in out["skipped"][0]["reason"]


def test_spec_builds_groups_null_and_one_fallback():
    out = w.compile_spec({
        "axes": [{"name": "SHOES", "kind": "accepts", "tags": ["sneakers", "boots"]},
                 {"name": "neg", "kind": "accepts", "tags": ["formal"]}],
        "null_weight": 2,
        "options": [
            {"text": "jeans", "weight": 1, "tags": ["sneakers", "boots"], "negative": "",
             "fallback": True},
            {"text": "suit", "weight": 1, "tags": ["formal"], "negative": "", "fallback": True},
        ],
    }, var="outfit")
    p = out["payload"]
    assert p["var_binding"] == "outfit"
    assert p["tag_groups"] == {"SHOES": ["sneakers", "boots"], "neg": ["formal"]}
    assert p["tag_group_kinds"] == {"SHOES": "accepts", "neg": "classify"}
    assert [o.get("fallback") for o in p["options"]] == [True, None, None]
    assert p["options"][-1] == {"id": p["options"][-1]["id"], "value": "", "is_null": True,
                                "weight": 2, "sub_categories": []}
    assert any("neg" in x for x in out["warnings"])
    assert any("offers no SHOES tag" in x for x in out["warnings"])


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


def test_the_draft_can_add_tag_groups_and_accepts():
    existing = {"sub_categories": ["casual", "boots"], "tag_groups": {"style": ["casual"]},
                "tag_group_kinds": {}}
    answer = {"options": [
        {"text": "school uniform", "weight": 1, "tags": ["formal", "loafers", "sneakers"],
         "negative": ""},
        {"text": "hiking gear", "weight": 1, "tags": ["casual", "Boots"], "negative": ""},
        {"text": "ball gown", "weight": 1, "tags": ["formal"], "negative": ""},
    ], "axes": [
        {"name": "style", "kind": "classify", "tags": ["formal", "casual"]},
        {"name": "SHOES", "kind": "accepts", "tags": ["loafers", "sneakers", "boots", "heels"]},
        {"name": "neg", "kind": "accepts", "tags": ["casual"]},
    ]}
    out = w.compile_options(answer, existing_payload=existing)
    groups, notes = w.new_groups(answer["axes"], existing_payload=existing,
                                  new_tags=out["new_tags"], options=out["options"])
    # "casual" is already in style; "heels" is on no option; "Boots" keeps
    # the wildcard's spelling; a tag already grouped never moves.
    assert groups == [{"name": "style", "kind": "classify", "tags": ["formal"]},
                      {"name": "SHOES", "kind": "accepts",
                       "tags": ["loafers", "sneakers", "boots"]}]
    assert any("isn't a usable name" in n for n in notes)
    assert any("1 new option offers no SHOES tag (e.g. ball gown)" in n for n in notes)
    # Nothing new: no group comes back.
    assert w.new_groups([], existing_payload=existing, new_tags=[]) == ([], [])


def test_the_draft_prompt_names_accepts_groups():
    text = w.build_user_prompt(instruction="more", count=3, name="Outfit", var_binding="outfit",
                                existing_options=["jeans"], tags=["boots"],
                                axes={"SHOES": ["boots"]}, kinds={"SHOES": "accepts"})
    assert "Tag group SHOES (accepts: what an option goes with): boots" in text
    assert "accepts" in w.draft_prompt() and w.DRAFT_SCHEMA["required"] == ["axes", "options"]


def test_a_bang_in_a_ref_filter_is_stored_as_not():
    idx = refs.RefIndex([COLORS])
    assert refs.compile_refs("@{Colors:!warm}", idx) == "@{c0c0c0c0#Colors:not warm}"
    assert refs.compile_refs("@{Colors:!warm!null}", idx) == "@{c0c0c0c0#Colors:not warm!null}"


def test_template_draft_warns_about_unasked_vars_and_drops_stray_braces():
    from engine.ai import text_items
    # Re-test on d6ac847 (9B): a three-variable ask read ~20 library vars,
    # and one draft came back 502 for "{portrait}".
    warn = text_items.unasked("$a, $b, $c, $d", "use $a and $b", ["a", "b", "c", "d"])
    assert warn.startswith("Also reads $c, $d, which you didn't ask for")
    assert text_items.unasked("$a, $c", "use $a", ["a", "c"]) == ""
    out = text_items.compile_template({"template": "{portrait} of $a, { }"},
                                      catalog={"a": {"sources": [{"kind": "wildcard"}]}})
    assert out["payload"]["template_string"] == "portrait of $a,"
    assert any('Dropped the braces around "portrait"' in w for w in out["warnings"])
    out = text_items.compile_template({"template": "$a, @{ }, ${}"},
                                      catalog={"a": {"sources": [{"kind": "wildcard"}]}})
    assert out["payload"]["template_string"] == "$a, ,"
    assert any("Dropped an empty @{ } / ${ }" in w for w in out["warnings"])


def test_braces_around_a_lone_ref_are_dropped():
    from engine.ai.refs import RefIndex, compile_text
    palette = {"id": "aaaa0001", "name": "Palette", "payload": {
        "sub_categories": ["warm"],
        "options": [{"value": "crimson", "sub_categories": ["warm"]}]}}
    out = compile_text("{@{Palette:warm}} sky", surface="option", refs=RefIndex([palette]))
    assert out == "@{aaaa0001#Palette:warm} sky"
