"""Chat eval round 1 (Dumi's 9B log, 2026-10-17): repeated cards, run_test
naming, derivations stuck on one branch, constraint errors with an example."""
from __future__ import annotations

import pytest

from engine.ai import chat
from tests.engine.ai.test_ai_chat_tools import _lib

STYLE = {"name": "Model Style Tags", "var": "model_style", "options": [
    {"text": "cinematic lighting", "tags": ["cinematic"]},
    {"text": "anime shading", "tags": ["anime"]}]}


def test_the_same_wildcard_again_replaces_its_card():
    lib = _lib()
    first = lib.run("create_wildcard", STYLE)
    again = lib.run("create_wildcard", {**STYLE, "options": [
        *STYLE["options"], {"text": "noir contrast"}]})
    assert again["replaces"] == first["pid"]
    assert again["op"]["body"]["id"] == first["op"]["body"]["id"]
    # No "already set by Model Style Tags (proposed)": it is the same card.
    assert not any("already set" in w for w in again["warnings"])
    rows = [m for m in lib.modules.values() if m.get("name") == "Model Style Tags"]
    assert len(rows) == 1 and len(rows[0]["payload"]["options"]) == 3
    assert "replaces card p1" in chat.proposal_note("create_wildcard", again)
    assert lib.replaced == {first["pid"]: again["pid"]}


def test_another_wildcard_for_a_proposed_variable_is_refused_with_its_id():
    lib = _lib()
    first = lib.run("create_wildcard", STYLE)
    iid = first["op"]["body"]["id"]
    with pytest.raises(ValueError, match=rf"already set by \[\[{iid}#Model Style Tags\]\].*"
                                         rf"reuse it .*edit_options.*{iid}"):
        lib.run("create_wildcard", {**STYLE, "name": "Style Tags"})
    # A library item keeps the warning: two writers on purpose are allowed.
    out = lib.run("create_wildcard", {"name": "More outfits", "var": "outfit",
                                      "options": [{"text": "cape"}]})
    assert any("already set by [[aaaa0001#Outfit]]" in w for w in out["warnings"])


def test_the_same_derivation_or_constraint_again_replaces_its_card():
    lib = _lib()
    rule = {"branches": [{"conditions": [{"var": "season", "op": "equals",
                                          "value": "winter"}],
                          "actions": [{"target_var": "cue", "value": "snow"}]}]}
    a = lib.run("create_derivation", {"name": "Cues", "rules": [rule]})
    b = lib.run("create_derivation", {"name": "cues", "rules": [rule, rule]})
    assert b["replaces"] == a["pid"] and b["op"]["body"]["id"] == a["op"]["body"]["id"]
    c1 = lib.run("create_constraint", {"source_id": "Season", "target_id": "Outfit", "rules": [
        {"source": "#cold", "target": "#sneakers", "effect": "exclude"}]})
    c2 = lib.run("create_constraint", {"source_id": "aaaa0002", "target_id": "aaaa0001",
                                       "name": "Winter shoes", "rules": [
        {"source": "#cold", "target": "sundress", "effect": "exclude"}]})
    assert c2["replaces"] == c1["pid"]


def test_a_card_pointing_at_a_replaced_card_waits_for_the_new_one():
    lib = _lib()
    first = lib.run("create_wildcard", STYLE)
    iid = first["op"]["body"]["id"]
    con = lib.run("create_constraint", {"source_id": iid, "target_id": "Outfit", "rules": [
        {"source": "#anime", "target": "#warm", "effect": "exclude"}]})
    assert con["after"] == first["pid"]
    again = lib.run("create_wildcard", {**STYLE, "options": STYLE["options"][:1]})
    assert again["op"]["body"]["id"] == iid and lib.replaced[first["pid"]] == again["pid"]


def test_run_test_finds_items_the_way_the_model_names_them():
    lib = _lib()
    style = lib.run("create_wildcard", STYLE)
    iid = style["op"]["body"]["id"]
    # A chip, a name with its kind, a card id; proposed cards run without
    # "proposed": true.
    for ref in (f"{iid}#Model Style Tags", "Model Style Tag wildcard", style["pid"],
                f"[[{iid}#Model Style Tags]]"):
        out = lib.run("run_test", {"stack": [ref], "seeds": 10})
        assert "$model_style" in out, ref
    # "A → B" names the constraint between two items.
    out = lib.run("run_test", {"stack": ["aaaa0002 → aaaa0001"], "seeds": 10})
    assert "$season" in out and "$outfit" in out
    with pytest.raises(ValueError, match="nothing to run; Left out Sequence Frame Cues"):
        lib.run("run_test", {"stack": ["Sequence Frame Cues"]})


def test_run_test_says_when_a_derivation_never_leaves_one_branch():
    lib = _lib()
    lib.run("create_derivation", {"name": "Mood Cue", "rules": [{
        "branches": [{"conditions": [{"var": "mood", "op": "equals", "value": "sad"}],
                      "actions": [{"target_var": "cue", "value": "rain"}]}],
        "else_actions": [{"target_var": "cue", "value": "sun"}]}]})
    out = lib.run("run_test", {"stack": ["Mood Cue"], "seeds": 20})
    assert ('Mood Cue set $cue to "sun" on every seed' in out
            and "nothing in this run sets $mood" in out and "pins" in out)
    assert lib.last_card["warnings"][0]["count"] == 20
    # Pinned, what it reads never changes: one value is right, no note.
    out = lib.run("run_test", {"stack": ["Mood Cue"], "seeds": 20, "pins": {"mood": "sad"}})
    assert "on every seed" not in out
    # One branch and no else: one value is all it can give.
    lib2 = _lib()
    lib2.run("create_derivation", {"name": "Snow", "rules": [{"branches": [{"conditions": [
        {"var": "season", "op": "exists"}], "actions": [{"target_var": "w", "value": "x"}]}]}]})
    assert "on every seed" not in lib2.run("run_test", {"stack": ["Season", "Snow"],
                                                        "seeds": 10})


def test_run_test_plays_loop_frames_for_a_derivation_reading_the_loop():
    lib = _lib()
    lib.run("create_derivation", {"name": "Shot Type", "rules": [{
        "branches": [{"conditions": [{"var": "$iteration", "op": "equals", "value": 1}],
                      "actions": [{"target_var": "$shot", "value": "establishing shot"}]}],
        "else_actions": [{"target_var": "shot", "value": "close-up"}]}]})
    out = lib.run("run_test", {"stack": ["Shot Type"], "seeds": 20})
    assert 'Loop frame 1 of 3 ($iteration = 1): $shot = "establishing shot" 100%' in out
    assert 'Loop frame 2 of 3 ($iteration = 2): $shot = "close-up" 100%' in out
    assert "on every seed" not in out
    # Pinned by the model: its own run says it all.
    out = lib.run("run_test", {"stack": ["Shot Type"], "seeds": 5, "pins": {"iteration": "2"}})
    assert "Loop frame" not in out


def test_rules_the_way_a_small_model_writes_them():
    lib = _lib()
    when = [{"var": "season", "op": "equals", "value": "winter"}]
    out = lib.run("create_derivation", {"name": "Extra", "rules": [
        # Conditions and actions split over two branch objects.
        {"branches": [{"conditions": when, "match": "all"}, {"match": "any"},
                      {"actions": [{"target_var": "extra", "value": "scarf"}]}]},
        {"summary": "only a summary"},
        # An else-only rule: the ELSE of the rule before.
        {"else_actions": [{"target_var": "extra", "value": "hat"}]},
        # Again, now that rule 1 has that ELSE: dropped.
        {"else_actions": [{"target_var": "extra", "value": "hat"}]},
        # A default for another variable: only when it is still empty.
        {"else_actions": [{"target_var": "title", "value": "Adventurer"}]},
    ]})
    rules = out["op"]["body"]["payload"]["rules"]
    assert len(rules) == 2 and not out["warnings"]
    assert rules[0]["branches"][0]["action"]["value"] == "scarf"
    assert rules[0]["else"]["action"]["value"] == "hat"
    assert rules[1]["branches"][0]["condition"] == {"var": "title", "op": "is_empty",
                                                   "value": ""}
    # The same rule many times over is one rule.
    rule = {"branches": [{"conditions": when, "actions": [{"target_var": "x", "value": "y"}]}]}
    many = lib.run("create_derivation", {"name": "Many", "rules": [rule] * 30})
    assert len(many["op"]["body"]["payload"]["rules"]) == 1
    # A value that came out as JSON punctuation says so.
    with pytest.raises(ValueError, match="came out as '}]}],', which is JSON"):
        lib.run("create_derivation", {"name": "Junk", "rules": [{"branches": [{
            "conditions": [{"var": "$iteration", "op": "equals", "value": "}]}], "}],
            "actions": [{"target_var": "shot", "value": "a"}]}]}]})


def test_an_unchanged_resend_makes_no_new_card():
    lib = _lib()
    first = lib.run("create_wildcard", STYLE)
    again = lib.run("create_wildcard", STYLE)
    assert isinstance(again, str) and f"exactly card {first['pid']}" in again
    nxt = lib.run("create_wildcard", {**STYLE, "options": STYLE["options"][:1]})
    assert nxt["pid"] == "p2" and nxt["replaces"] == "p1"


def test_failed_rules_show_one_rule_that_works():
    lib = _lib()
    with pytest.raises(ValueError) as e:
        lib.run("create_constraint", {"source_id": "Colors", "target_id": "Season", "rules": [
            {"source": "#warm interior", "target": "#lighting-cinematic",
             "effect": "exclude"}]})
    msg = str(e.value)
    assert 'A rule that works here: {"source": "#warm", "target": "#cold"' in msg
    assert 'options 1 "winter", 2 "summer"' in msg
    with pytest.raises(ValueError) as e:
        lib.run("create_derivation", {"name": "Cue", "rules": [{"branches": [{
            "conditions": [{"var": "iteration_total", "op": "equals", "value": "3"}],
            "actions": [{"target_var": None, "value": "x"}]}]}]})
    assert "A rule that works:" in str(e.value) and '"var": "outfit"' in str(e.value)


# ── round 2 ──────────────────────────────────────────────────────────────


def test_a_wildcard_with_no_var_sets_one_named_after_it():
    lib = _lib()
    # The library's Outfit sets $outfit: a new Outfit writes it too.
    out = lib.run("create_wildcard", {"name": "Outfit", "options": [{"text": "cape"}]})
    payload = out["op"]["body"]["payload"]
    assert payload["var_binding"] == "outfit"
    assert out["warnings"][0].startswith("Sets $outfit, named after it")
    hair = lib.run("create_wildcard", {"name": "Hair Colour", "options": [{"text": "red"}]})
    assert hair["op"]["body"]["payload"]["var_binding"] == "hair_colour"
    # "" is still a vocabulary.
    voc = lib.run("create_wildcard", {"name": "Hues", "var": "", "options": [{"text": "teal"}]})
    assert not voc["op"]["body"]["payload"].get("var_binding")


def test_conditions_written_with_match_or_without_var():
    lib = _lib()
    act = [{"target_var": "shot", "value": "close-up"}]
    good = {"conditions": [{"var": "iteration", "op": "equals", "value": "1"}],
            "actions": [{"target_var": "shot", "value": "establishing shot"}]}
    # {"match": "any"} written as a condition belongs to the group.
    out = lib.run("create_derivation", {"name": "Shot", "rules": [{"branches": [
        good, {"conditions": [{"match": "any"}, {"var": "season", "op": "equals",
                                                 "value": "winter"}], "actions": act}]}]})
    assert len(out["op"]["body"]["payload"]["rules"][0]["branches"]) == 2
    # A broken branch costs that branch, with a note; the good one stays.
    out = lib.run("create_derivation", {"name": "Shot 2", "rules": [{"branches": [
        good, {"conditions": [{"match": "all", "op": "equals", "value": "1"}],
               "actions": act}]}]})
    assert len(out["op"]["body"]["payload"]["rules"][0]["branches"]) == 1
    assert any('branch 2: condition 1 has no "var"' in w and '"match" belongs on the branch'
               in w for w in out["warnings"])
    with pytest.raises(ValueError, match='condition 1 has no "var"'):
        lib.run("create_derivation", {"name": "Shot 3", "rules": [{"branches": [
            {"conditions": [{"op": "equals", "value": "1"}], "actions": act}]}]})


def test_a_constraint_on_a_derivation_says_what_it_is():
    lib = _lib()
    with pytest.raises(ValueError, match=r"\[\[aaaa0003#Extras\]\] is a derivation, not a "
                                         "wildcard"):
        lib.run("create_constraint", {"source_id": "aaaa0003", "target_id": "aaaa0001",
                                      "rules": [{"source": "#cold", "target": "#warm",
                                                 "effect": "exclude"}]})


def test_run_test_takes_a_template_chip_and_runs_the_most_used_of_a_shared_name():
    lib = _lib()
    lib.templates["746c1f41"] = {**lib.templates["tttt0001"], "id": "746c1f41",
                                 "name": "Environments"}
    out = lib.run("run_test", {"stack": ["Look"], "template": "746c1f41#Environments",
                               "seeds": 3})
    assert "Prompt:" in out
    for i in (8, 9):
        lib.modules[f"aaaa000{i}"] = {
            "id": f"aaaa000{i}", "type": "wildcard", "name": "Lighting", "tags": [],
            "payload": {"var_binding": "light", "options": [
                {"id": "l1", "value": f"lamp {i}", "weight": 1}]}}
    lib.modules["aaaa0010"] = {"id": "aaaa0010", "type": "constraint", "name": "x", "tags": [],
                               "payload": {"source_wildcard_id": "aaaa0009",
                                           "target_wildcard_id": "aaaa0001",
                                           "matrix": {}, "exceptions": []}}
    out = lib.run("run_test", {"stack": ["Lighting"], "seeds": 5})
    assert "ran aaaa0009 (the most used); the others are aaaa0008" in out
    assert '"lamp 9" 100%' in out


def test_the_same_edit_twice_names_the_card_that_made_it():
    lib = _lib()
    edit = {"id": "aaaa0002", "negatives": [{"n": 1, "negative": "sunny"}]}
    first = lib.run("edit_options", edit)
    with pytest.raises(ValueError, match=f"card {first['pid']} already makes this change"):
        lib.run("edit_options", edit)


def test_run_test_says_when_every_option_was_picked():
    lib = _lib()
    lib.run("create_wildcard", {"name": "Tones", "var": "tone", "options": [
        {"text": f"tone {i}"} for i in range(8)]})
    out = lib.run("run_test", {"stack": ["Tones"], "seeds": 200})
    assert "All 8 options of Tones were picked" in out


# ── round 3 ──────────────────────────────────────────────────────────────


def test_a_constraint_side_listing_several_options_is_a_rule_each():
    lib = _lib()
    for target in ("2, 3", "sundress, jacket"):
        out = lib.run("create_constraint", {"source_id": "Season", "target_id": "Outfit",
                                            "name": f"No {target}", "rules": [
            {"source": "#cold", "target": target, "effect": "exclude"}]})
        assert not any("isn't an option" in w for w in out["warnings"]), target
        excluded = {e["target"] for e in out["op"]["body"]["payload"]["exceptions"]}
        assert excluded == {"sundress", "rain jacket"}, target
    # One option's own text with a comma stays one option.
    lib.modules["aaaa0001"]["payload"]["options"][0]["value"] = "wool coat, boots"
    out = lib.run("create_constraint", {"source_id": "Season", "target_id": "Outfit",
                                        "name": "Coat", "rules": [
        {"source": "summer", "target": "wool coat, boots", "effect": "exclude"}]})
    assert [e["target"] for e in out["op"]["body"]["payload"]["exceptions"]] \
        == ["wool coat, boots"]


def test_items_named_the_way_answers_write_them_and_tools_as_ids():
    lib = _lib()
    out = lib.run("run_test", {"stack": ["Season (aaaa0002)"], "seeds": 5})
    assert "$season" in out
    with pytest.raises(ValueError, match="'create_wildcard' is a tool, not an item"):
        lib.run("read", {"id": "create_wildcard"})


def test_the_chat_changes_only_library_items_the_user_named():
    lib = _lib()
    lib.named = lib.named_in("Make a new outfit wildcard")
    assert lib.named == set()
    with pytest.raises(ValueError, match=r"\[\[aaaa0001#Outfit\]\] is the user's own item"):
        lib.run("edit_options", {"id": "aaaa0001", "negatives": [{"n": 1, "negative": "x"}]})
    # Its own cards are always open.
    card = lib.run("create_wildcard", {"name": "Capes", "var": "cape",
                                       "options": [{"text": "red cape"}]})
    lib.run("add_options", {"id": card["op"]["body"]["id"], "options": [{"text": "blue cape"}]})
    for said in ("add rain to my Season", "change Outfit", "tweak my outfits list",
                 "fix aaaa0001", "edit the season wildcard"):
        assert lib.named_in(said), said
    assert "aaaa0002" in lib.named_in("make the season wildcard warmer")
    lib.named = lib.named_in("make my Outfit warmer")
    lib.run("edit_options", {"id": "aaaa0001", "negatives": [{"n": 1, "negative": "x"}]})


def test_wrong_kind_refusals_name_the_tool_to_use():
    """All-tools eval: the 9B retried the wrong tool after "is a template,
    not a wildcard", and made wildcards named "Portrait Template"."""
    lib = _lib()
    rule = {"branches": [{"conditions": [{"var": "season", "op": "equals",
                                          "value": "winter"}],
                          "actions": [{"target_var": "cue", "value": "snow"}]}]}
    d = lib.run("create_derivation", {"name": "Cues", "rules": [rule]})
    did = d["op"]["body"]["id"]
    with pytest.raises(ValueError, match=r"is a derivation, not a wildcard.*use edit_rules"):
        lib.run("add_options", {"id": did, "options": [{"text": "x"}]})
    with pytest.raises(ValueError, match=r'names a template.*create_template.*"templates"'):
        lib.run("create_wildcard", {"name": "Portrait Template", "var": "portrait",
                                    "options": [{"text": "a"}]})
    with pytest.raises(ValueError, match=r"names a fixed values.*create_fixed_values"):
        lib.run("create_wildcard", {"name": "Quality Fixed Values", "var": "q",
                                    "options": [{"text": "a"}]})
    try:
        out = lib.run("edit_rules", {"id": did, "replace": [{"n": 2, "rule": rule}]})
        text = " ".join(out["warnings"])
    except ValueError as e:
        text = str(e)
    assert "it has 1 rule, counting from 1; add_rules adds a new one" in text


def test_an_id_made_of_json_brackets_says_so():
    lib = _lib()
    with pytest.raises(ValueError, match="came out as JSON brackets"):
        lib.run("read", {"id": "}}] } ]} ,"})


def test_option_zero_is_refused_with_the_numbering():
    lib = _lib()
    with pytest.raises(ValueError, match="numbered from 1.*no empty option"):
        lib.run("edit_options", {"id": "aaaa0001", "weights": [{"n": 0, "weight": 1}]})
