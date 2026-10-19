"""AI rule drafters: derivations, constraints and the variable catalog."""
from __future__ import annotations

import pytest

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import library_vars, refs
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler

CLASS_WC = {
    "type": "wildcard", "name": "Class",
    "payload": {"var_binding": "class", "sub_categories": ["magic", "melee"], "options": [
        {"id": "c1", "value": "mage", "sub_categories": ["magic"]},
        {"id": "c2", "value": "warrior", "sub_categories": ["melee"]},
        {"id": "c3", "value": "", "is_null": True},
    ]},
}
WEAPON_WC = {
    "type": "wildcard", "name": "Weapon",
    "payload": {"var_binding": "weapon", "sub_categories": ["staff", "blade"], "options": [
        {"id": "w1", "value": "oak staff", "sub_categories": ["staff"]},
        {"id": "w2", "value": "crystal staff", "sub_categories": ["staff"]},
        {"id": "w3", "value": "longsword", "sub_categories": ["blade"]},
    ]},
}
LIBRARY = [
    CLASS_WC, WEAPON_WC,
    {"type": "fixed_values", "name": "Style",
     "payload": {"values": [{"name": "style", "value": "x"}]}},
    {"type": "combine", "name": "Look", "payload": {"output_var": "look"}},
    {"type": "derivation", "name": "Titles", "payload": {"rules": [{"id": "r1", "branches": [{
        "condition": {"var": "class", "op": "equals", "value": "mage"},
        "action": {"target_var": "title", "mode": "replace", "value": "Archmage"},
        "extra_actions": [{"target_var": "class", "mode": "negative", "value": "x"}],
    }]}]}},
]


def test_catalog_lists_every_variable_source():
    cat = library_vars.build_catalog(LIBRARY)
    assert cat["class"]["values"] == ["mage", "warrior"]
    assert cat["class"]["tags"] == ["magic", "melee"]
    assert cat["style"]["sources"] == [{"kind": "fixed_values", "module": "Style"}]
    assert cat["look"]["sources"][0]["kind"] == "combine"
    assert cat["title"]["sources"] == [{"kind": "derivation", "module": "Titles"}]
    # A negative-only action writes no variable.
    assert [s["kind"] for s in cat["class"]["sources"]] == ["wildcard"]
    assert "sdxl" in cat["model_family"]["values"]
    assert "pony" in cat["model_variant"]["values"]
    text = library_vars.describe(cat, focus=["title"])
    assert text.splitlines()[0].startswith("$title (set by derivation")
    assert '$class (wildcard "Class"): mage, warrior  [tags: magic, melee]' in text


def _A(value):
    return {"target_var": "a", "mode": "replace", "value": value}


def _drv(rules):
    return {"rules": rules}


def test_derivation_compiles_groups_and_extra_actions():
    cat = library_vars.build_catalog(LIBRARY)
    out = ai_derivation.compile_rules(_drv([{
        "summary": "Mages with staves get a title",
        "branches": [
            {"match": "all", "conditions": [
                {"var": "$class", "op": "equals", "value": "Mage"},
                {"var": "weapon", "op": "contains", "value": "staff"},
            ], "actions": [
                {"target_var": "title", "mode": "replace", "value": "Archmage"},
                {"target_var": "$title", "mode": "negative", "value": "armor"},
            ]},
            {"match": "any", "conditions": [{"var": "class", "op": "exists", "value": "x"}],
             "actions": [{"target_var": "title", "mode": "replace", "value": "Adventurer"}]},
        ],
        "else_actions": [],
    }]), catalog=cat, taken_ids={"r1"})
    assert out["skipped"] == []
    [r] = out["rules"]
    rule = r["rule"]
    assert rule["id"].startswith("r_ai") and rule["id"] != "r1"
    b0, b1 = rule["branches"]
    assert b0["condition"] == {"match": "all", "conditions": [
        # Case fixed to the option's spelling: the engine compares exactly.
        {"var": "class", "op": "equals", "value": "mage"},
        {"var": "weapon", "op": "contains", "value": "staff"},
    ]}
    assert b0["action"] == {"target_var": "title", "mode": "replace", "value": "Archmage"}
    assert b0["extra_actions"] == [{"target_var": "title", "mode": "negative", "value": "armor"}]
    # One condition stays a single test; no-value ops lose their value.
    assert b1["condition"] == {"var": "class", "op": "exists", "value": ""}
    assert "extra_actions" not in b1 and "else" not in rule
    assert r["summary"] == "Mages with staves get a title"
    assert r["warnings"] == []
    DerivationHandler.validate_payload({"rules": [rule]})


def test_a_value_that_only_says_what_to_leave_out_goes_to_the_negative():
    cat = library_vars.build_catalog(LIBRARY)
    out = ai_derivation.compile_rules(_drv([{
        "summary": "No firearms in fantasy",
        "branches": [{"match": "all", "conditions": [
            {"var": "class", "op": "equals", "value": "Mage"}],
            "actions": [{"target_var": "weapon", "mode": "replace",
                         "value": "no guns, no firearms, no rifles"}]}]}]), catalog=cat)
    [r] = out["rules"]
    assert r["rule"]["branches"][0]["action"] == {
        "target_var": "weapon", "mode": "negative", "value": "guns, firearms, rifles"}
    assert any("only says what to leave out" in w for w in r["warnings"])


def test_derivation_warns_and_skips():
    cat = library_vars.build_catalog(LIBRARY)
    out = ai_derivation.compile_rules(_drv([
        {"summary": "", "branches": [{"match": "all", "conditions": [
            {"var": "class", "op": "equals", "value": "bard"},
            {"var": "mood", "op": "is_set", "value": ""},
        ], "actions": [{"target_var": "song", "mode": "replace",
                        "value": "$song_title by $title"}]}],
         "else_actions": [{"target_var": "song", "mode": "replace", "value": "silence"}]},
        {"summary": "bad var", "branches": [{"match": "all",
            "conditions": [{"var": "not a var", "op": "equals", "value": "x"}],
            "actions": [_A("b")]}], "else_actions": []},
        {"summary": "ref", "branches": [{"match": "all",
            "conditions": [{"var": "class", "op": "equals", "value": "mage"}],
            "actions": [_A("@{deadbeef}")]}], "else_actions": []},
        {"summary": "regex", "branches": [{"match": "all",
            "conditions": [{"var": "class", "op": "matches", "value": "("}],
            "actions": [_A("b")]}], "else_actions": []},
        {"summary": "not regex", "branches": [{"match": "all",
            "conditions": [{"var": "class", "op": "not_matches", "value": "(red"}],
            "actions": [_A("b")]}], "else_actions": []},
        {"summary": "empty", "branches": [], "else_actions": []},
    ]), catalog=cat)
    [r] = out["rules"]
    assert r["warnings"] == [
        '$class has no option "bard"',
        ai_derivation.unset_note("mood"),
        ai_derivation.unset_note("song_title"),
    ]
    assert r["rule"]["else"] == {
        "action": {"target_var": "song", "mode": "replace", "value": "silence"},
    }
    assert "IF ($class equals \"bard\" and $mood is_set)" in r["summary"]
    # A rule with nothing in it is dropped without a note.
    assert [s["text"] for s in out["skipped"]] == ["bad var", "ref", "regex", "not regex"]
    with pytest.raises(ValueError):
        ai_derivation.compile_rules({"nope": 1}, catalog=cat)


def test_derivation_actions_pick_from_wildcards_by_name():
    idx = refs.RefIndex([{"id": "c0c0c0c0", "name": "Weapons", "type": "wildcard",
                          "payload": {"sub_categories": ["arcane"], "options": []}}])
    cat = library_vars.build_catalog(LIBRARY)
    out = ai_derivation.compile_rules(_drv([
        {"summary": "gear", "branches": [{"match": "all",
            "conditions": [{"var": "class", "op": "equals", "value": "mage"}],
            "actions": [{"target_var": "gear", "mode": "append",
                         "value": ", @{Weapons:arcane} on {a belt|the back}"}]}],
         "else_actions": []},
        {"summary": "pick in a condition", "branches": [{"match": "all",
            "conditions": [{"var": "class", "op": "equals", "value": "{a|b}"}],
            "actions": [_A("b")]}], "else_actions": []},
        {"summary": "loop", "branches": [{"match": "all",
            "conditions": [{"var": "iteration", "op": "equals", "value": "1"}],
            "actions": [_A("first")]}], "else_actions": []},
    ]), catalog=cat, refs=idx)
    gear, loop = out["rules"]
    assert gear["rule"]["branches"][0]["action"]["value"] == (
        ", @{c0c0c0c0#Weapons:arcane} on {a belt|the back}")
    assert loop["warnings"] == []
    assert [s["text"] for s in out["skipped"]] == ["pick in a condition"]


def _sides():
    return ai_constraint.side_view(CLASS_WC, "S"), ai_constraint.side_view(WEAPON_WC, "T")


def test_constraint_prompt_numbers_options_and_lists_tags():
    s, t = _sides()
    text = ai_constraint.build_prompt(instruction="mages use staves", source=s, target=t,
                                      existing=["#magic → #blade: exclude ×0"])
    assert "SOURCE wildcard: Class ($class)" in text
    assert "S1. mage  [#magic]" in text and "T3. longsword  [#blade]" in text
    assert "S3" not in text  # the null option isn't listed
    assert "#magic → #blade: exclude ×0" in text


def test_constraint_compiles_cells_exceptions_and_expansion():
    s, t = _sides()
    existing = {
        "matrix": {"magic": {"blade": {"mode": "exclude", "factor": 0}}},
        "exceptions": [
            {"source": "warrior", "target": "oak staff", "mode": "reduce", "factor": 0.5},
        ],
    }
    out = ai_constraint.compile_rules({"rules": [
        {"source": "#magic", "target": "#blade", "effect": "exclude", "factor": 5,
         "reason": "no swords"},
        {"source": "#Magic", "target": "#blade", "effect": "boost", "factor": 3, "reason": "dup"},
        {"source": "S2", "target": "T1", "effect": "boost", "factor": 0.2, "reason": ""},
        {"source": "#melee", "target": "#staff", "effect": "reduce", "factor": 7, "reason": ""},
        {"source": "mage", "target": "T2", "effect": "only", "factor": 9, "reason": "focus"},
        {"source": "T1", "target": "T1", "effect": "exclude", "factor": 0, "reason": ""},
        {"source": "#nope", "target": "T1", "effect": "exclude", "factor": 0, "reason": ""},
    ]}, source=s, target=t, existing=existing)
    assert out["cells"] == [
        {"source_tag": "magic", "target_tag": "blade", "cell": {"mode": "exclude", "factor": 0},
         "reason": "no swords", "replaces": True},
        {"source_tag": "melee", "target_tag": "staff", "cell": {"mode": "reduce", "factor": 0.5},
         "reason": "", "replaces": False},
    ]
    excs = out["exceptions"]
    assert excs[0] == {"exception": {"source": "warrior", "target": "oak staff", "mode": "boost",
                                     "factor": 2, "source_id": "c2", "target_id": "w1"},
                       "reason": "", "from": "", "replaces": True}
    assert excs[1]["exception"] == {"source": "mage", "target": "crystal staff", "mode": "only",
                                    "factor": 1, "source_id": "c1", "target_id": "w2"}
    assert len(excs) == 2
    assert [x["reason"] for x in out["skipped"]] == [
        "the source isn't an option or tag (its tags: #magic, #melee); "
        "one option or tag per side, a rule each",
    ] * 2


def test_constraint_tag_to_option_expands_per_option():
    s, t = _sides()
    out = ai_constraint.compile_rules({"rules": [
        {"source": "S1", "target": "#staff", "effect": "boost", "factor": 2.5, "reason": "x"},
    ]}, source=s, target=t)
    assert out["cells"] == []
    assert [e["exception"]["target"] for e in out["exceptions"]] == ["oak staff", "crystal staff"]
    assert {e["from"] for e in out["exceptions"]} == {"mage → #staff"}
    payload = {"source_wildcard_id": "a", "target_wildcard_id": "b", "matrix": {},
               "exceptions": [e["exception"] for e in out["exceptions"]]}
    ConstraintHandler.validate_payload(payload)
    ConstraintHandler.validate_authoring(payload)


def test_prompts_carry_description_and_labels():
    from engine.ai import about
    from engine.ai import wildcard as ai_wildcard
    from engine.ai import wildcard_edit as ai_edit
    raw_tags = ["winter", "", 3, "winter", "cozy"]
    desc, labels = about.clean("  Outfits for a\ncozy  winter set ", raw_tags)
    assert (desc, labels) == ("Outfits for a cozy winter set", ["winter", "cozy"])
    expect = "Labels (the module's own tags): winter, cozy"
    draft = ai_wildcard.build_user_prompt(
        instruction="x", count=3, name="Outfit", var_binding="outfit", existing_options=[],
        tags=[], description="Outfits", labels=labels)
    assert "Description: Outfits" in draft and expect in draft
    edit = ai_edit.build_edit_prompt(
        action="remove", instruction="x", name="Outfit", var_binding="", options=[], tags=[],
        description="Outfits", labels=labels)
    assert expect in edit
    drv = ai_derivation.build_prompt(
        instruction="x", name="T", catalog_text="", existing_rules=[],
        description="Titles per class", labels=["rpg"])
    assert "Description: Titles per class" in drv
    described = {**CLASS_WC, "description": "Fantasy classes", "tags": ["rpg"]}
    s = ai_constraint.side_view(described, "S")
    _, t = _sides()
    cn = ai_constraint.build_prompt(instruction="x", source=s, target=t, existing=[],
                                    name="Class weapons", description="Who carries what")
    assert "Constraint: Class weapons" in cn and "Description: Who carries what" in cn
    assert "  Description: Fantasy classes" in cn


def test_catalog_shows_module_descriptions():
    lib = [{**CLASS_WC, "description": "Fantasy character classes for portraits"}]
    text = library_vars.describe(library_vars.build_catalog(lib))
    assert '$class (wildcard "Class") — Fantasy character classes for portraits' in text


def test_describe_summaries_and_answer():
    from engine.ai import describe as ai_describe
    s = ai_describe.summarize("wildcard", CLASS_WC["payload"])
    assert "Variable: $class" in s and "- mage" in s and "Option tags: magic, melee" in s
    s = ai_describe.summarize("constraint", {
        "source_wildcard_id": "a", "target_wildcard_id": "b",
        "matrix": {"magic": {"blade": {"mode": "exclude", "factor": 0}}}, "exceptions": [],
    }, names={"a": "Class", "b": "Weapon"})
    assert "Links wildcard Class (source) to Weapon (target)." in s and "#magic → #blade" in s
    child = {"type": "wildcard", "name": "Class", "description": "classes"}
    s = ai_describe.summarize("bundle", [child])
    assert s == "- wildcard Class: classes"
    s = ai_describe.summarize("derivation", LIBRARY[4]["payload"])
    assert '$class equals "mage"' in s
    assert "opt" not in ai_describe.summarize("combine", {"id": "opt1", "template": "a $b"})
    rows = [{"tags": ["rpg", "Fantasy"]}, {"tags": ["rpg"]}]
    assert ai_describe.library_tags(rows) == ["rpg", "Fantasy"]
    out = ai_describe.compile_answer(
        {"description": ' "Fantasy classes  for portraits." ',
         "tags": ["#RPG", "fantasy", "new one", "rpg", "x" * 40]},
        current=["rpg"], library=["Fantasy"])
    assert out["description"] == "Fantasy classes for portraits."
    assert out["tags"] == [
        {"tag": "rpg", "new": False, "has": True},
        {"tag": "Fantasy", "new": False, "has": False},
        {"tag": "new one", "new": True, "has": False},
    ]
    with pytest.raises(ValueError):
        ai_describe.compile_answer({"description": "", "tags": []}, current=[], library=[])


def test_constraint_prompt_shows_tag_groups_and_only_keeps_named_targets():
    wc = {"name": "Outfit", "payload": {
        "var_binding": "outfit", "sub_categories": ["summer", "spring", "dress"],
        "tag_groups": {"season": ["summer", "spring"], "kind": ["dress"]},
        "tag_group_kinds": {"season": "accepts"},
        "options": [{"id": "o1", "value": "sundress", "sub_categories": ["summer", "dress"]}]}}
    side = ai_constraint.side_view(wc, "T")
    assert {"name": "season", "kind": "accepts", "tags": ["summer", "spring"]} in side["groups"]
    text = ai_constraint.build_prompt(instruction="x", source=side, target=side, existing=[])
    assert "ACCEPTS group season: #summer, #spring" in text
    assert "CLASSIFY group kind: #dress" in text
    # The prompt agrees with the engine: reduce/boost rules keep their target.
    assert "only, reduce or boost rule" in ai_constraint.SYSTEM_PROMPT


def test_append_and_prepend_get_a_list_separator():
    # The engine joins as written: "tie" + "watch" would print "tiewatch".
    cat = library_vars.build_catalog(LIBRARY)
    out = ai_derivation.compile_rules(_drv([{"branches": [
        {"conditions": [{"var": "class", "op": "equals", "value": "mage"}], "actions": [
            {"target_var": "look", "mode": "append", "value": "watch"},
            {"target_var": "look", "mode": "prepend", "value": "hooded"},
            {"target_var": "look", "mode": "append", "value": ", ring"},
        ]}]}]), catalog=cat)
    b = out["rules"][0]["rule"]["branches"][0]
    assert b["action"]["value"] == ", watch"
    assert [a["value"] for a in b["extra_actions"]] == ["hooded, ", ", ring"]


def test_append_and_prepend_values_bring_their_separator():
    cat = library_vars.build_catalog(LIBRARY)

    def act(mode, value):
        return {"target_var": "gear", "mode": mode, "value": value}

    out = ai_derivation.compile_rules(_drv([{"summary": "gear", "branches": [{
        "match": "all", "conditions": [{"var": "class", "op": "equals", "value": "mage"}],
        "actions": [act("append", "watch"), act("append", " ring"),
                    act("append", ", belt"), act("prepend", "hat")]}],
        "else_actions": []}]), catalog=cat)
    branch = out["rules"][0]["rule"]["branches"][0]
    values = [branch["action"]["value"], *(a["value"] for a in branch["extra_actions"])]
    assert values == [", watch", ", ring", ", belt", "hat, "]


def test_a_last_catch_all_branch_becomes_the_else():
    """Browser test (9B): "anyone else → Adventurer" written as a last
    branch `class not_equals ""` after the mage and warrior branches."""
    cat = library_vars.build_catalog(LIBRARY)

    def branch(op, value, title):
        return {"match": "all", "conditions": [{"var": "class", "op": op, "value": value}],
                "actions": [{"target_var": "title", "mode": "replace", "value": title}]}

    out = ai_derivation.compile_rules(_drv([{
        "summary": "Titles", "else_actions": [], "branches": [
            branch("equals", "Mage", "Archmage"), branch("equals", "Warrior", "Champion"),
            branch("not_equals", "", "Adventurer")]}]), catalog=cat)
    rule = out["rules"][0]["rule"]
    assert len(rule["branches"]) == 2
    assert rule["else"]["action"]["value"] == "Adventurer"


def test_a_draft_missing_an_asked_variable_says_so():
    from engine.ai import text_items
    assert text_items.missing_asked("$char_desc, $expression",
                                    "read $quality_tags, $char_desc and $expression") == (
        "Doesn't read $quality_tags, which you asked for")
    assert text_items.missing_asked("$a $b", "use $a and $b") == ""


def test_values_wrapped_in_quotes_lose_them():
    # Re-test on b793872 (9B): every $iteration rule wrote "'establishing shot'".
    out = ai_derivation.compile_rules({"rules": [{"branches": [{
        "conditions": [{"var": "iteration", "op": "equals", "value": "1"}],
        "actions": [{"target_var": "shot", "value": "'establishing shot'"}]}],
        "else_actions": [{"target_var": "shot", "value": "“close-up”"}]}]},
        catalog={})
    rule = out["rules"][0]["rule"]
    assert rule["branches"][0]["action"]["value"] == "establishing shot"
    assert rule["else"]["action"]["value"] == "close-up"
    assert ai_derivation._unquote("say 'hi' and 'bye'") == "say 'hi' and 'bye'"


def test_a_dropped_catch_all_is_warned_about():
    # Re-test on b793872 (9B): "anyone else Adventurer" came back with no ELSE.
    branch = {"branches": [{"conditions": [{"var": "class", "op": "equals", "value": "mage"}],
                            "actions": [{"target_var": "title", "value": "Archmage"}]}]}
    rules = [x["rule"] for x in ai_derivation.compile_rules({"rules": [branch]},
                                                            catalog={})["rules"]]
    asked = "mage gets Archmage, anyone else gets Adventurer"
    assert "anyone else" in ai_derivation.missing_else(asked, rules)
    assert ai_derivation.missing_else("mage gets Archmage", rules) == ""
    with_else = [{**rules[0], "else": {"action": {"target_var": "title", "value": "x"}}}]
    assert ai_derivation.missing_else(asked, with_else) == ""


def test_a_catch_all_split_into_a_second_rule_joins_the_first():
    # Re-test on 367a6a5 (9B): "mage → Archmage" then "warrior → Champion,
    # else Adventurer" as two rules, so every mage ended up an Adventurer.
    def branch(cls, title):
        return {"conditions": [{"var": "class", "op": "equals", "value": cls}],
                "actions": [{"target_var": "title", "value": title}]}
    out = ai_derivation.compile_rules({"rules": [
        {"branches": [branch("mage", "Archmage")]},
        {"branches": [branch("warrior", "Champion")],
         "else_actions": [{"target_var": "title", "value": "Adventurer"}]}]}, catalog={})
    assert len(out["rules"]) == 1
    rule = out["rules"][0]["rule"]
    assert [b["action"]["value"] for b in rule["branches"]] == ["Archmage", "Champion"]
    assert rule["else"]["action"]["value"] == "Adventurer"
    # Rules on different variables stay apart.
    apart = ai_derivation.compile_rules({"rules": [
        {"branches": [branch("mage", "Archmage")]},
        {"branches": [{"conditions": [{"var": "season", "op": "equals", "value": "winter"}],
                       "actions": [{"target_var": "title", "value": "Frost"}]}],
         "else_actions": [{"target_var": "title", "value": "Wanderer"}]}]}, catalog={})
    assert len(apart["rules"]) == 2


def test_else_repair_attaches_to_the_rule_without_one():
    rules = [x["rule"] for x in ai_derivation.compile_rules({"rules": [{"branches": [{
        "conditions": [{"var": "class", "op": "equals", "value": "mage"}],
        "actions": [{"target_var": "title", "value": "Archmage"}]}]}]}, catalog={})["rules"]]
    added = ai_derivation.attach_else({"otherwise": [
        {"target_var": "title", "mode": "replace", "value": "\"Adventurer\""}]}, rules, {})
    assert added == "$title = Adventurer"
    assert rules[0]["else"]["action"]["value"] == "Adventurer"
    assert ai_derivation.attach_else({"otherwise": []}, rules, {}) == ""
    assert ai_derivation.else_schema(["title"])["properties"]["otherwise"]["items"][
        "properties"]["target_var"]["enum"] == ["title"]
    assert "anyone else" in ai_derivation.else_prompt(
        "mage Archmage, anyone else Adventurer", rules)
