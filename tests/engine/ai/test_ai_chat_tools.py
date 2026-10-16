"""engine/ai/chat_tools.py — the chat's tools past wildcards and rules."""
from __future__ import annotations

import pytest

from engine.ai import chat, guide


def _lib():
    modules = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Outfit", "tags": [],
         "payload": {"var_binding": "outfit", "sub_categories": ["warm", "boots", "sneakers"],
                     "options": [
                         {"id": "o1", "value": "wool coat", "weight": 1,
                          "sub_categories": ["warm", "boots"]},
                         {"id": "o2", "value": "sundress", "weight": 1,
                          "sub_categories": ["sneakers"]},
                         {"id": "o3", "value": "rain jacket", "weight": 1,
                          "sub_categories": []},
                     ]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Season", "tags": [],
         "payload": {"var_binding": "season", "sub_categories": ["cold"], "options": [
             {"id": "s1", "value": "winter", "weight": 1, "sub_categories": ["cold"]},
             {"id": "s2", "value": "summer", "weight": 1, "sub_categories": []},
         ]}},
        {"id": "aaaa0003", "type": "derivation", "name": "Extras", "tags": [],
         "payload": {"rules": [{
             "id": "r1", "summary": "",
             "branches": [{"condition": {"var": "season", "op": "equals",
                                         "value": "winter"},
                           "action": {"target_var": "extra", "mode": "replace",
                                      "value": "scarf"}}],
         }]}},
        {"id": "aaaa0004", "type": "constraint", "name": "Season → Outfit", "tags": [],
         "payload": {"source_wildcard_id": "aaaa0002", "target_wildcard_id": "aaaa0001",
                     "matrix": {"cold": {"warm": {"mode": "boost", "factor": 3}}},
                     "exceptions": []}},
        {"id": "aaaa0005", "type": "fixed_values", "name": "Quality", "tags": [],
         "payload": {"values": [{"id": "v1", "name": "quality",
                                 "value": "masterpiece, best quality"}]}},
        {"id": "aaaa0006", "type": "combine", "name": "Look", "tags": [],
         "payload": {"template": "$season, $outfit", "output_var": "look",
                     "input_vars": ["season", "outfit"]}},
        {"id": "aaaa0007", "type": "wildcard", "name": "Colors", "tags": [],
         "payload": {"sub_categories": ["warm"], "options": [
             {"id": "c1", "value": "red", "weight": 1, "sub_categories": ["warm"]},
             {"id": "c2", "value": "blue", "weight": 1, "sub_categories": []},
         ]}},
    ]
    bundles = [{"id": "bbbb0001", "name": "Kit", "tags": [], "children": [
        {"id": "aaaa0002", "type": "wildcard", "enabled": True, "meta": {"name": "Season"},
         "payload": modules[1]["payload"], "instance": {}},
        {"id": "aaaa0001", "type": "wildcard", "enabled": True, "meta": {"name": "Outfit"},
         "payload": modules[0]["payload"], "instance": {"pick_min": 1, "pick_max": 2}},
    ]}]
    templates = [{"id": "tttt0001", "name": "Portrait", "tags": [], "description": "",
                  "template_string": "$look, $quality", "negative_template": ""}]
    return chat.Library(modules, bundles, [], templates)


def test_tools_are_listed_and_guide_is_in_the_prompt():
    for tool in ("create_fixed_values", "edit_values", "create_combine", "edit_combine",
                 "create_template", "edit_template", "edit_rules", "edit_constraint",
                 "create_bundle", "edit_bundle", "run_test"):
        assert tool in chat.TOOLS and f"- {tool} " in chat.SYSTEM_PROMPT
    assert "not_contains" in chat.SYSTEM_PROMPT  # schema v10 NOT toggle
    assert guide.WHICH.splitlines()[0] in chat.SYSTEM_PROMPT
    assert "pick 2-3" in chat.SYSTEM_PROMPT


def test_read_every_kind():
    lib = _lib()
    assert "Used by: constraint Season → Outfit (target); bundle Kit" in lib.read(
        {"id": "aaaa0001"})
    assert "1. $quality = masterpiece, best quality" in lib.read({"id": "aaaa0005"})
    assert "Sets $look = $season, $outfit" in lib.read({"id": "aaaa0006"})
    rules = lib.read({"id": "aaaa0003"})
    assert "Rules (1, each runs on its own" in rules and "winter" in rules
    con = lib.read({"id": "aaaa0004"})
    assert "Reaches every target after it." in con and "1. #cold → #warm: boost ×3" in con
    kit = lib.read({"id": "bbbb0001"})
    assert "2. wildcard Outfit  [use: pick 1-2]" in kit
    tpl = lib.read({"id": "tttt0001"})
    assert "template \"Portrait\"" in tpl and "Template: $look, $quality" in tpl
    assert "vocabulary" in lib.read({"id": "aaaa0007"})
    assert "3 template" not in lib.overview() and "1 template" in lib.overview()


def test_names_work_where_ids_do():
    lib = _lib()
    assert "Variable: $season" in lib.run("read", {"id": "Season"})
    p = lib.run("add_options", {"id": "season", "options": [{"text": "autumn"}]})
    assert p["op"]["id"] == "aaaa0002"


def test_fixed_values_create_and_edit():
    lib = _lib()
    p = lib.run("create_fixed_values", {"name": "Style", "values": [
        {"name": "$style", "value": "anime, {cel|flat} shading", "negative": "3d render"},
        {"name": "bad name", "value": "x"}]})
    vals = p["op"]["body"]["payload"]["values"]
    assert [v["name"] for v in vals] == ["style"] and vals[0]["negative"] == "3d render"
    assert any("bad name" in w for w in p["warnings"])
    with pytest.raises(ValueError, match="can't read \\$variables"):
        lib.run("create_fixed_values", {"name": "X", "values": [{"name": "a", "value": "$b"}]})
    e = lib.run("edit_values", {"id": "aaaa0005", "set": [
        {"name": "quality", "value": "best quality", "negative": "lowres"}]})
    row = e["op"]["body"]["payload"]["values"][0]
    assert row["id"] == "v1" and row["value"] == "best quality" and row["negative"] == "lowres"
    assert e["after"] is None
    e2 = lib.run("edit_values", {"id": "aaaa0005", "remove": ["$quality"]})
    assert e2["after"] == e["pid"] and e2["op"]["body"]["payload"]["values"] == []


def test_combine_create_and_edit():
    lib = _lib()
    p = lib.run("create_combine", {"name": "Scene", "var": "scene",
                                   "template": "$look in {spring|autumn}, $nope"})
    pay = p["op"]["body"]["payload"]
    assert pay["output_var"] == "scene" and pay["input_vars"] == ["look", "nope"]
    assert any("$nope" in w for w in p["warnings"])
    with pytest.raises(ValueError, match="@"):
        lib.run("create_combine", {"name": "S", "var": "s", "template": "@{Colors}"})
    with pytest.raises(ValueError, match="sets itself"):
        lib.run("create_combine", {"name": "S", "var": "s", "template": "$s and $look"})
    e = lib.run("edit_combine", {"id": "Look", "negative": "blurry"})
    assert e["op"]["body"]["payload"]["negative"] == "blurry"
    assert e["op"]["body"]["payload"]["template"] == "$season, $outfit"
    with pytest.raises(ValueError, match="changes nothing"):
        lib.run("edit_combine", {"id": "aaaa0006", "template": "$season, $outfit"})


def test_template_create_and_edit():
    lib = _lib()
    p = lib.run("create_template", {"name": "Full", "template": "$look, $extra",
                                    "negative": "$negatives, lowres"})
    assert p["op"]["kind"] == "template" and p["op"]["op"] == "create"
    assert p["op"]["body"]["template_string"] == "$look, $extra"
    assert p["op"]["body"]["negative_template"] == "$negatives, lowres"
    with pytest.raises(ValueError, match="doesn't pick"):
        lib.run("create_template", {"name": "Bad", "template": "a {red|blue} $look"})
    e = lib.run("edit_template", {"id": "Portrait", "negative": "lowres"})
    assert e["op"] == {**e["op"], "op": "update", "kind": "template", "id": "tttt0001",
                       "body": {"template_string": "$look, $quality",
                                "negative_template": "lowres"}}
    info = lib.run("update_info", {"id": "tttt0001", "tags_add": ["portrait"]})
    assert info["op"]["kind"] == "template"


def test_edit_rules_replace_and_remove():
    lib = _lib()
    p = lib.run("edit_rules", {"id": "Extras", "replace": [{"n": 1, "rule": {
        "summary": "", "branches": [{"match": "all", "conditions": [
            {"var": "season", "op": "equals", "value": "winter"}],
            "actions": [{"target_var": "extra", "mode": "replace",
                         "value": "@{Colors:warm} scarf"}]}],
        "else_actions": []}}]})
    rule = p["op"]["body"]["payload"]["rules"][0]
    assert rule["id"] == "r1"
    assert "@{aaaa0007#Colors:warm} scarf" in str(rule)
    assert "@{Colors:warm} scarf" in p["preview"][0]
    r = lib.run("edit_rules", {"id": "aaaa0003", "remove": [1]})
    assert r["op"]["body"]["payload"]["rules"] == []
    with pytest.raises(ValueError, match="changes nothing"):
        _lib().run("edit_rules", {"id": "aaaa0003", "remove": [7]})


def test_edit_constraint_rules_remove_and_reach():
    lib = _lib()
    p = lib.run("edit_constraint", {"id": "aaaa0004", "remove": [1], "reach": "next 2",
                                    "rules": [{"source": "winter", "target": "sundress",
                                               "effect": "exclude"}]})
    pay = p["op"]["body"]["payload"]
    assert pay["matrix"] == {}
    assert pay["target_select"] == {"mode": "next", "count": 2}
    assert len(pay["exceptions"]) == 1 and pay["exceptions"][0]["mode"] == "exclude"
    assert "Reaches the next 2 targets after it" in p["preview"]
    with pytest.raises(ValueError, match="reach"):
        lib.run("edit_constraint", {"id": "aaaa0004", "reach": "sometimes"})
    c = lib.run("create_constraint", {"source_id": "Season", "target_id": "Outfit",
                                      "reach": "first", "rules": [
                                          {"source": "#cold", "target": "#warm",
                                           "effect": "boost", "factor": 2}]})
    assert c["op"]["body"]["payload"]["target_select"] == {"mode": "first"}


def test_wildcard_spec_in_chat():
    lib = _lib()
    p = lib.run("create_wildcard", {
        "name": "Scarf", "var": "scarf", "null_weight": 2,
        "axes": [{"name": "SHOES", "kind": "accepts", "tags": ["boots"]}],
        "options": [{"text": "@{Colors:warm} scarf", "tags": ["boots"], "fallback": True},
                    {"text": "{knit|silk} scarf", "tags": ["boots"]}]})
    pay = p["op"]["body"]["payload"]
    assert pay["options"][0]["value"] == "@{aaaa0007#Colors:warm} scarf"
    assert pay["options"][0]["fallback"] is True
    assert any(o.get("is_null") and o["weight"] == 2 for o in pay["options"])
    assert pay["tag_groups"] == {"SHOES": ["boots"]}
    assert pay["tag_group_kinds"] == {"SHOES": "accepts"}
    v = lib.run("create_wildcard", {"name": "Fabrics", "var": "",
                                    "options": [{"text": "wool"}, {"text": "silk"}]})
    assert "var_binding" not in v["op"]["body"]["payload"]
    assert v["summary"].startswith("vocabulary")
    with pytest.raises(ValueError, match="unique name"):
        lib.run("create_wildcard", {"name": "colors", "var": "", "options": [{"text": "x"}]})
    with pytest.raises(ValueError):
        lib.run("create_wildcard", {"name": "Bad", "var": "bad",
                                    "options": [{"text": "$season coat"}]})


def test_edit_options_negatives_fallback_null_and_axes():
    lib = _lib()
    p = lib.run("edit_options", {"id": "Outfit",
                                 "negatives": [{"n": 2, "negative": "{bare|naked} legs"}],
                                 "fallback": 3, "null_weight": 1.5,
                                 "axes": [{"name": "SHOES", "kind": "accepts",
                                           "tags": ["boots", "sneakers", "heels"]}]})
    pay = p["op"]["body"]["payload"]
    opts = pay["options"]
    assert opts[1]["negative"] == "{bare|naked} legs"
    assert opts[2]["fallback"] is True
    assert opts[-1]["is_null"] and opts[-1]["weight"] == 1.5
    assert pay["tag_groups"] == {"SHOES": ["boots", "sneakers"]}
    assert any("heels" in w for w in p["warnings"])
    assert any("offers no SHOES" in w for w in p["warnings"])
    q = lib.run("edit_options", {"id": "aaaa0001", "fallback": 0, "null_weight": 0})
    assert not any(o.get("fallback") or o.get("is_null")
                   for o in q["op"]["body"]["payload"]["options"])
    with pytest.raises(ValueError, match="changes nothing"):
        _lib().run("edit_options", {"id": "aaaa0001", "null_weight": 0})


def test_create_bundle_orders_and_sets_use():
    lib = _lib()
    p = lib.run("create_bundle", {"name": "Set", "items": [
        "Look", "Extras", {"item": "Outfit", "use": "pick 2-3; filter warm; hold; bogus"},
        "Season Outfit", "Season → Outfit", "Season", "Quality", "Portrait"]})
    kids = p["op"]["body"]["children"]
    names = [k["meta"]["name"] for k in kids]
    assert names.index("Season") < names.index("Season → Outfit") < names.index("Outfit")
    assert names.index("Quality") < names.index("Look")
    assert names.index("Extras") < names.index("Look")
    outfit = kids[names.index("Outfit")]
    assert outfit["instance"] == {"pick_min": 2, "pick_max": 3, "category_filter": "warm",
                                  "seed_scope": "hold"}
    assert outfit["payload_hash"] and "name" not in outfit
    assert any("bogus" in w for w in p["warnings"])
    assert any("template" in w for w in p["warnings"])
    assert any("Season Outfit" in w for w in p["warnings"])


def test_edit_bundle():
    lib = _lib()
    p = lib.run("edit_bundle", {"id": "Kit", "use": [{"n": 2, "use": "no empty"}],
                                "add": ["Look"]})
    kids = p["op"]["body"]["children"]
    assert kids[1]["instance"] == {"exclude_null": True}
    assert kids[-1]["id"] == "aaaa0006"
    assert p["op"]["before"]["children"][1]["instance"] == {"pick_min": 1, "pick_max": 2}
    r = lib.run("edit_bundle", {"id": "bbbb0001", "remove": [1]})
    assert r["after"] == p["pid"] and len(r["op"]["body"]["children"]) == 2


def test_run_test_reports_values_never_picked_and_prompts():
    lib = _lib()
    out = lib.run("run_test", {"stack": ["Season", "Season → Outfit", "Outfit", "Quality",
                                         "Look"], "seeds": 60, "template": "Portrait"})
    assert out.startswith("Ran 60 seeds.")
    assert "$season: " in out and "$look: " in out
    assert out.count("Prompt: ") == 3 and "masterpiece" in out
    lib2 = _lib()
    lib2.run("edit_constraint", {"id": "aaaa0004", "rules": [
        {"source": "#cold", "target": "#warm", "effect": "exclude"},
        {"source": "summer", "target": "wool coat", "effect": "exclude"}]})
    cmp = lib2.run("run_test", {"stack": ["Season", "Season → Outfit", "Outfit"],
                                "seeds": 50, "proposed": True})
    assert "with the proposed changes (was → now)" in cmp
    assert "Never picked in Outfit: wool coat" in cmp
    assert "% → " in cmp
    kit = _lib().run("run_test", {"stack": [{"item": "Kit"}], "seeds": 20})
    assert "$outfit" in kit
    with pytest.raises(ValueError, match="nothing to run"):
        _lib().run("run_test", {"stack": ["nope"]})
    assert "Ran Season, Kit on 100 seeds" == chat.args_note(
        "run_test", {"stack": ["Season", {"item": "Kit"}]})


def test_pins_feed_inputs():
    lib = chat.Library([{"id": "aaaa0009", "type": "combine", "name": "Say", "tags": [],
                         "payload": {"template": "hello $who", "output_var": "said",
                                     "input_vars": ["who"]}}], [], [])
    out = lib.run("run_test", {"stack": ["Say"], "pins": {"$who": "world"}, "seeds": 5})
    assert '$said: "hello world" 100%' in out


# ── a constraint's stack needs ──────────────────────────────────────────


def test_with_needs_adds_a_constraints_wildcards_in_run_order():
    lib = _lib()
    ids, notes = lib.with_needs(["aaaa0004"])
    assert ids == ["aaaa0002", "aaaa0004", "aaaa0001"]
    assert "Season and Outfit" in notes[0]
    # Target first: the constraint moves ahead of it.
    ids, notes = lib.with_needs(["aaaa0002", "aaaa0001", "aaaa0004"])
    assert ids == ["aaaa0002", "aaaa0004", "aaaa0001"] and "moved" in notes[0]
    # In a bundle on the stack counts as there.
    assert lib.with_needs(["bbbb0001", "aaaa0004"])[0] == ["bbbb0001", "aaaa0004"]


def test_run_test_and_show_test_take_the_constraint_alone():
    from engine.ai import client_tools
    lib = _lib()
    out = lib.run_test({"stack": ["Season → Outfit"], "seeds": 5})
    assert "added Season and Outfit" in out
    args, _ = client_tools.prepare(lib, "show_test", {"stack": ["aaaa0004"]})
    assert args["stack"] == [{"module": "aaaa0002"}, {"module": "aaaa0004"},
                             {"module": "aaaa0001"}]
    assert args["notes"]


def test_show_test_add_and_remove_keep_the_open_seeds():
    from engine.ai import client_tools
    lib = _lib()
    args, label = client_tools.prepare(lib, "show_test", {"stack": ["Quality"], "change": "add"})
    assert args["change"] == "add" and "seeds" not in args and label.startswith("Added 1 item")
    # Taking a constraint out never pulls its wildcards out with it.
    args, label = client_tools.prepare(lib, "show_test", {"stack": ["aaaa0004"],
                                                          "change": "remove", "seeds": 5})
    assert args["stack"] == [{"module": "aaaa0004"}] and args["seeds"] == 5
    with pytest.raises(ValueError):
        client_tools.prepare(lib, "show_test", {"stack": ["Quality"], "change": "swap"})


def test_ids_copied_from_chips_and_cards_still_name_the_item():
    lib = _lib()
    assert "Variable: $season" in lib.run("read", {"id": "[[aaaa0002#Season]]"})
    assert "Variable: $season" in lib.run("read", {"id": "aaaa0002#Season"})
    shoes = lib.run("create_wildcard", {"name": "Shoes", "var": "shoes",
                                        "options": [{"text": "boots", "tags": ["warm"]}]})
    new_id = shoes["op"]["body"]["id"]
    for ref in (shoes["pid"], f"{new_id}#Shoes", f"@{{{new_id}}}"):
        c = lib.run("create_constraint", {"source_id": "Season", "target_id": ref, "rules": [
            {"source": "#cold", "target": "#warm", "effect": "boost", "factor": 2}]})
        assert c["op"]["body"]["payload"]["target_wildcard_id"] == new_id


def test_a_name_proposed_again_in_this_answer_means_its_own_card():
    from engine.ai import client_tools
    lib = _lib()
    # Another kind sharing the source's name doesn't make it ambiguous.
    lib.modules["bbbb0001"] = {"id": "bbbb0001", "type": "combine", "name": "Season",
                               "tags": [], "payload": {"template": "$season"}}
    made = lib.run("create_wildcard", {
        "name": "Outfit", "var": "outfit_demo",
        "options": [{"text": "t-shirt", "tags": ["light"]},
                    {"text": "wool coat", "tags": ["warm"]}]})
    new_id = made["op"]["body"]["id"]
    assert new_id != "aaaa0001"
    con = lib.run("create_constraint", {
        "source_id": "Season", "target_id": "Outfit",
        "rules": [{"source": "winter", "target": "#warm", "effect": "only"}]})
    assert con["op"]["body"]["payload"]["target_wildcard_id"] == new_id
    assert con["op"]["body"]["payload"]["source_wildcard_id"] == "aaaa0002"
    # Its cards show once the answer ends: opening one now is refused with why.
    for raw in (made["pid"], new_id):
        with pytest.raises(ValueError, match="already on screen"):
            client_tools.prepare(lib, "open", {"proposal": raw})
