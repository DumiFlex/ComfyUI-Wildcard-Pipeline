"""The Draft with AI panels held to their requests (bench critiques
2026-10-26: #10, #13, #15, #17, #20, #21, #22, #36, #44)."""
from __future__ import annotations

from pathlib import Path

from engine.ai import derivation as ai_derivation
from engine.ai import library_vars, text_items
from engine.ai import scripts as ai_scripts
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_edit


def _opt(text: str, *tags: str) -> dict:
    return {"text": text, "weight": 1, "tags": list(tags), "negative": ""}


# ── wildcards ──────────────────────────────────────────────────────────

def test_over_delivery_is_trimmed_per_tag_group():
    # Bench Z1: asked 10 split by coverage, the first 10 of 14 held 1 sheer.
    raw = {"options": [_opt(f"modest piece {i}", "modest") for i in range(6)]
           + [_opt(f"revealing piece {i}", "revealing") for i in range(5)]
           + [_opt(f"sheer piece {i}", "sheer") for i in range(3)]}
    out = ai_wildcard.compile_options(
        raw, existing_payload={"options": [], "sub_categories": []}, limit=9,
        request="9 lingerie pieces, tagged by coverage: modest, revealing or sheer")
    tags = [o["tags"][0] for o in out["options"]]
    assert len(tags) == 9 and tags.count("sheer") == 3 and tags.count("modest") == 3
    assert sum(1 for s in out["skipped"] if s["reason"] == "more than you asked for") == 5


def test_untagged_answer_to_a_tag_ask_is_re_asked():
    asked = "10 hairstyles for fantasy characters, tagged by length: short or long"
    assert ai_wildcard.asked_tags(asked) == ["short", "long"]
    note = ai_wildcard.untagged_note(asked, [{"tags": []}])
    assert "one of short, long" in note
    assert ai_wildcard.untagged_note(asked, [{"tags": ["short"]}]) == ""
    # Z20: a tagged list gets untagged additions.
    tagged = [{"value": "x", "sub_categories": ["sheer"]}]
    assert "existing tags" in ai_wildcard.untagged_note("4 more like this", [{"tags": []}],
                                                        tagged)
    assert ai_wildcard.untagged_note("4 more", [{"tags": []}], [{"value": "x"}]) == ""


def test_options_lose_their_quotes_and_other_scripts():
    out = ai_wildcard.compile_options(
        {"options": [_opt('"red silk robe"'), _opt("lace 睡衣 slip"), _opt("velvet gown")]},
        existing_payload={"options": [{"value": "cotton dress"}], "sub_categories": []},
        request="3 more")
    assert [o["value"] for o in out["options"]] == ["red silk robe", "velvet gown"]
    assert any("another script" in s["reason"] for s in out["skipped"])


def test_a_removal_whose_reason_says_keep_is_dropped():
    asked = "drop anything that could not exist before 1900"
    for keep in ("common pre-1900", "existed in the 1800s", "medieval garment"):
        assert ai_edit.argues_keep(keep, asked), keep
    for remove in ("too modern", "did not exist before 1900", "invented in 1950",
                   "20th century synthetic"):
        assert not ai_edit.argues_keep(remove, asked), remove
    rows = [{"id": "1", "value": "cloak", "weight": 1, "sub_categories": []},
            {"id": "2", "value": "hoodie", "weight": 1, "sub_categories": []}]
    out = ai_edit.compile_edit("remove", {"remove": [
        {"id": "1", "reason": "common pre-1900"}, {"id": "2", "reason": "too modern"}]},
        options=rows, registry=[], instruction=asked)
    assert [c["id"] for c in out["changes"]] == ["2"]


def test_retag_warns_about_a_tag_on_every_option():
    rows = [{"id": str(i), "value": f"o{i}", "weight": 1, "sub_categories": []}
            for i in range(1, 4)]
    out = ai_edit.compile_edit("retag", {"options": [
        {"id": str(i), "tags": ["suggestive"]} for i in range(1, 4)]},
        options=rows, registry=[], instruction="tag each by how explicit")
    assert any("#suggestive is now on every option" in w for w in out["warnings"])


def test_booru_rewrite_names_unknown_tags():
    rows = [{"id": "1", "value": "denim jacket", "weight": 1, "sub_categories": []}]
    known = {"denim_jacket", "white_shirt"}
    out = ai_edit.compile_edit("rewrite", {"options": [
        {"id": "1", "text": "denim jacket, cool_rebel_vibe"}]}, options=rows, registry=[],
        instruction="rewrite as Danbooru tags", known_tag=lambda t: t.replace(" ", "_") in known)
    assert out["changes"][0]["warning"] == "Not in your tag list: cool_rebel_vibe"
    assert ai_edit.wants_booru("short Danbooru-style tags")


def test_tag_index_has_exact_names(tmp_path: Path):
    from wp_api._tag_index import load_index

    f = tmp_path / "tags.csv"
    f.write_text("denim_jacket,0,100,\"jean_jacket\"\nwhite_shirt,0,50,\n", encoding="utf-8")
    idx = load_index(f)
    assert idx is not None
    assert idx.has("denim jacket") and idx.has("Jean_Jacket") and not idx.has("denim")


def test_scripts():
    assert ai_scripts.foreign("soft 焦 focus", "a watercolor preset") == {"CJK"}
    assert ai_scripts.foreign("café", "cafe") == set()
    assert ai_scripts.strip_foreign("a, 曝光, b", "x") == ("a, b", ["曝光"])


# ── fixed values ───────────────────────────────────────────────────────

def test_fixed_values_drop_twins_and_clean_negatives():
    out = text_items.compile_fixed({"values": [
        {"name": "quality", "value": "masterpiece, best quality",
         "negative": "lowres, blurry, lowres, masterpiece"},
        {"name": "style", "value": "best quality, masterpiece", "negative": ""},
        {"name": "medium", "value": "watercolor painting, paper texture",
         "negative": "watercolor, 3d render, marker, pen, marker, pen"},
    ]}, request="a watercolor preset")
    rows = {r["name"]: r for r in out["rows"]}
    assert set(rows) == {"quality", "medium"}
    assert rows["quality"]["negative"] == "lowres, blurry"
    assert rows["medium"]["negative"] == "3d render, marker, pen"
    assert any("same text as $quality" in w for w in out["warnings"])
    assert all(r["status"] == "new" for r in out["rows"])


def test_fixed_values_keep_a_negative_only_value_and_mark_changes():
    existing = {"values": [{"id": "v1", "name": "style", "value": "anime"}]}
    out = text_items.compile_fixed({"values": [
        {"name": "style", "value": "90s retro anime", "negative": "3d"},
        {"name": "neg", "value": "", "negative": "child, teen"},
    ]}, existing=existing)
    rows = {r["name"]: r for r in out["rows"]}
    assert rows["style"]["status"] == "changed"
    assert rows["style"]["before"] == {"value": "anime", "negative": ""}
    assert rows["neg"]["value"] == "" and rows["neg"]["negative"] == "child, teen"
    assert any("only adds negative words" in w for w in out["warnings"])


# ── combines and templates ─────────────────────────────────────────────

_CAT = library_vars.build_catalog([
    {"type": "wildcard", "name": "Mood", "payload": {
        "var_binding": "mood", "options": [{"value": "angry"}, {"value": "calm"}]}},
    {"type": "wildcard", "name": "Race", "payload": {
        "var_binding": "race", "options": [{"value": "elf"}]}},
    {"type": "combine", "name": "Character", "payload": {"output_var": "character"}},
])


def test_combine_drops_its_own_read_and_warns_before_vowels():
    out = text_items.compile_combine({"template": "a $mood $race and $character",
                                      "negative": ""},
                                     out_var="character", catalog=_CAT, request="x")
    assert out["payload"]["template"] == "a $mood $race"
    assert any("sets it" in w for w in out["warnings"])
    assert any('"a $mood" reads "a angry"' in w for w in out["warnings"])


def test_unasked_only_counts_what_the_edit_added():
    asked = "also mention $hair_color and that they hold $weapon"
    reads = ["mood", "race", "hair_color", "weapon"]
    assert text_items.unasked("", asked, reads, had=["mood", "race"]) == ""
    assert "$mood" in text_items.unasked("", asked, reads)


def test_template_is_held_to_its_request():
    out = text_items.compile_template({
        "template": "$model_family $iteration, score_tags, {mood}, $race, bad anatomy, "
                    "masterpiece, masterpiece, (detailed",
        "negative": "$negatives, a, b, c, d, e, f, g, h, i, j"},
        catalog=_CAT, request="reorder it for a Pony checkpoint, with a short negative")
    p = out["payload"]
    assert p["template_string"] == ("score_9, score_8_up, score_7_up, $mood, $race, "
                                    "masterpiece, detailed")
    assert p["negative_template"] == "$negatives, bad anatomy, a, b, c, d, e, f, g"
    # A Pony ask that forgot the score tags gets them first.
    out = text_items.compile_template({"template": "$mood, $race", "negative": ""},
                                      catalog=_CAT, request="a Pony prompt")
    assert out["payload"]["template_string"].startswith("score_9, score_8_up")
    # Loop and model variables the request names stay.
    out = text_items.compile_template({"template": "$mood, frame $iteration", "negative": ""},
                                      catalog=_CAT, request="number frames with $iteration")
    assert "$iteration" in out["payload"]["template_string"]


def test_flux_ask_loses_quality_tags_and_tag_lists_are_re_asked():
    out = text_items.compile_template(
        {"template": "a $mood $race in a forest, masterpiece, best quality, 8k", "negative": ""},
        catalog=_CAT, request="a natural-sentence prompt for a Flux checkpoint")
    assert out["payload"]["template_string"] == "a $mood $race in a forest"
    notes = text_items.recheck_notes("template", {
        "template": "$character, $title, 8k, masterpiece, best quality, $scene"},
        "a natural-sentence prompt for a Flux checkpoint using $character")
    assert any("natural sentences" in n for n in notes)
    notes = text_items.recheck_notes("template", {"template": "$mood, $hair_color, $accessory"},
                                     "Make a close-up portrait template from mood and hair")
    assert any("only variables" in n and "close-up" in n for n in notes)
    assert text_items.recheck_notes("template", {"template": "portrait of $mood"},
                                    "a close-up portrait") == []


def test_prompt_catalog_hides_loop_and_model_vars():
    cat = text_items.prompt_catalog("template", _CAT, "a portrait")
    assert "iteration" not in cat and "model_family" not in cat and "mood" in cat
    assert "iteration" in text_items.prompt_catalog("template", _CAT, "use $iteration")
    assert "iteration" in text_items.prompt_catalog("fixed_values", _CAT, "")


def test_samples_render_library_options():
    lines = text_items.samples("a $mood $race", _CAT, seed="s", n=5)
    assert lines and all(line.endswith("elf") for line in lines)
    assert text_items.samples("a $mood $race", _CAT, seed="s", n=5) == lines
    assert text_items.samples("no vars", _CAT, seed="s") == []


# ── derivations ────────────────────────────────────────────────────────

_WEATHER = library_vars.build_catalog([{"type": "wildcard", "name": "Weather", "payload": {
    "var_binding": "weather", "options": [{"value": v} for v in (
        "snowfall", "heat haze", "clear sunny sky", "rain")]}}])


def _act(var: str, value: str, mode: str = "replace") -> dict:
    return {"target_var": var, "mode": mode, "value": value}


def _branch(*conds: tuple[str, str, str], acts: list[dict], match: str = "all") -> dict:
    return {"match": match, "conditions": [{"var": v, "op": o, "value": x} for v, o, x in conds],
            "actions": acts}


def test_split_if_elif_else_becomes_one_rule():
    # Bench R1 run 3: two rules and an else-only third; the ELSE then undid winter.
    raw = {"rules": [
        {"summary": "a", "branches": [_branch(("weather", "equals", "snowfall"),
                                              acts=[_act("season", "winter")])],
         "else_actions": []},
        {"summary": "b", "branches": [_branch(("weather", "equals", "heat haze"),
                                              ("weather", "equals", "clear sunny sky"),
                                              acts=[_act("season", "summer")], match="any")],
         "else_actions": []},
        {"summary": "c", "branches": [], "else_actions": [_act("season", "autumn")]},
    ]}
    out = ai_derivation.compile_rules(raw, catalog=_WEATHER)
    [rule] = [r["rule"] for r in out["rules"]]
    assert len(rule["branches"]) == 2 and rule["else"]["action"]["value"] == "autumn"


def test_an_else_that_overwrites_an_earlier_rule_warns():
    raw = {"rules": [
        {"summary": "a", "branches": [_branch(("weather", "contains", "snow"),
                                              acts=[_act("season", "winter")])],
         "else_actions": []},
        {"summary": "b", "branches": [_branch(("mood", "equals", "happy"),
                                              acts=[_act("season", "summer")])],
         "else_actions": [_act("season", "autumn")]},
    ]}
    out = ai_derivation.compile_rules(raw, catalog=_WEATHER)
    assert any("overwrites $season" in w for w in out["rules"][1]["warnings"])
    # Against the module's own rules too: a new rule runs after them.
    old = {"id": "r1", "branches": [{"condition": {"var": "weather", "op": "equals",
                                                   "value": "rain"},
                                     "action": _act("season", "spring")}]}
    out = ai_derivation.compile_rules({"rules": [raw["rules"][1]]}, catalog=_WEATHER,
                                      existing=[old])
    assert any("from rule 1" in w for w in out["rules"][0]["warnings"])


def test_an_edit_keeps_the_rule_and_its_else():
    # Bench R6 run 1: "rogues should be Shadowblade" lost "else Adventurer".
    old = {"id": "r1", "branches": [{"condition": {"var": "class", "op": "equals",
                                                   "value": "mage"},
                                     "action": _act("title", "Archmage")}],
           "else": {"action": _act("title", "Adventurer")}}
    raw = {"rules": [{"edits": 1, "summary": "rogues", "branches": [
        _branch(("class", "equals", "rogue"), acts=[_act("title", "Shadowblade")])],
        "else_actions": []}]}
    out = ai_derivation.compile_rules(raw, catalog={}, existing=[old], read_vars={"title"})
    [r] = out["rules"]
    assert r["replaces"] == "r1" and r["rule"]["id"] == "r1"
    assert [b["action"]["value"] for b in r["rule"]["branches"]] == ["Archmage", "Shadowblade"]
    assert r["rule"]["else"]["action"]["value"] == "Adventurer"
    # The same condition replaces its branch; "no else" drops the ELSE.
    raw["rules"][0]["branches"] = [_branch(("class", "equals", "mage"),
                                           acts=[_act("title", "Magus")])]
    merged = ai_derivation.merge_edit(old, ai_derivation.compile_rules(
        raw, catalog={})["rules"][0]["rule"], "mages are Magus, no else")
    assert [b["action"]["value"] for b in merged["branches"]] == ["Magus"]
    assert "else" not in merged
    assert "edits" in ai_derivation.EDIT_SCHEMA["properties"]["rules"]["items"]["required"]


def test_add_lands_as_append_and_exists_or_is_dropped():
    # Bench R4: "exists OR does not contain" always holds, and "add" became a set.
    raw = {"rules": [{"summary": "dry", "branches": [_branch(
        ("weather", "exists", ""), ("weather", "not_contains", "rain"),
        acts=[_act("season", "dry ground")], match="any")], "else_actions": []}]}
    out = ai_derivation.compile_rules(
        raw, catalog=_WEATHER,
        request="also: when $weather does not contain rain, add 'dry ground' to $season")
    rule = out["rules"][0]["rule"]
    assert rule["branches"][0]["condition"] == {"var": "weather", "op": "not_contains",
                                                "value": "rain"}
    assert rule["branches"][0]["action"]["mode"] == "append"


def test_a_neg_target_is_a_negative_and_a_bad_action_costs_only_itself():
    # Bench Z8: one invalid action ("$pose.neg") dropped the whole rule.
    raw = {"rules": [{"summary": "nude", "branches": [_branch(
        ("pose", "contains", "nude"), acts=[
            _act("lingerie", ""), _act("$pose.neg", "clothes, underwear"),
            _act("bad name!", "x")])], "else_actions": []}]}
    out = ai_derivation.compile_rules(raw, catalog={})
    b = out["rules"][0]["rule"]["branches"][0]
    acts = [b["action"], *b.get("extra_actions", [])]
    assert acts[1] == {"target_var": "pose", "mode": "negative", "value": "clothes, underwear"}
    assert len(acts) == 2
    assert any("left out an action" in w for w in out["rules"][0]["warnings"])


def test_unread_targets_warn():
    modules = [
        {"type": "combine", "payload": {"template": "$mood $race", "output_var": "who"}},
        {"type": "derivation", "payload": {"rules": [{"branches": [{"condition": {
            "var": "weather", "op": "equals", "value": "x"},
            "action": _act("light", "$season")}]}]}},
    ]
    reads = library_vars.read_vars(modules, [{"template_string": "$who, $detail.neg"}])
    assert reads == {"mood", "race", "weather", "season", "who", "detail"}
    raw = {"rules": [{"summary": "s", "branches": [_branch(
        ("weather", "equals", "rain"), acts=[_act("extra", "wet")])], "else_actions": []}]}
    out = ai_derivation.compile_rules(raw, catalog=_WEATHER, read_vars=reads)
    assert any("reads $extra" in w for w in out["rules"][0]["warnings"])


def test_samples_render_fixed_values_and_combines():
    catalog = {"race": {"values": ["elf"]}, "quality": {"values": []}, "character": {"values": []}}
    texts = text_items.sample_texts([
        {"id": "f1", "type": "fixed_values", "payload": {"values": [
            {"id": "a", "name": "quality", "value": "masterpiece"}]}},
        {"id": "c1", "type": "combine", "payload": {"output_var": "character",
                                                     "template": "a $race knight"}},
        {"id": "me", "type": "combine", "payload": {"output_var": "self", "template": "x"}},
    ], skip="me")
    assert "self" not in texts
    out = text_items.samples("$quality, $character, $scene", catalog, seed="s", texts=texts)
    assert out == ["masterpiece, a elf knight, $scene"]


def test_word_echoing_the_options_is_dropped():
    catalog = {"hair_color": {"values": ["brown hair", "red hair", "black hair"]}}
    warnings: list[str] = []
    text, _ = text_items._tidy_text("a knight with $hair_color hair", "", "", catalog,
                                     warnings, kind="combine")
    assert text == "a knight with $hair_color"
    assert any("already end in it" in w for w in warnings)
