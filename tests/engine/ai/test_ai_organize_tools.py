"""Organization tools the chat gained from real use: bulk changes, category
looks, renames, clearing a category, and tag groups / option tags."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from engine.ai import chat, chat_manage
from engine.ai import wildcard as ai_wildcard

ROOT = Path(__file__).resolve().parents[3]


def _lib():
    modules = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Outfit", "tags": ["fashion"],
         "category_id": "clothes", "payload": {
             "var_binding": "outfit", "sub_categories": ["warm", "cold", "red"],
             "tag_groups": {"Weather": ["warm", "cold"]},
             "tag_group_kinds": {"Weather": "classify"},
             "options": [
                 {"id": "o1", "value": "coat", "weight": 1, "sub_categories": ["cold", "red"]},
                 {"id": "o2", "value": "dress", "weight": 1, "sub_categories": ["warm"]},
             ]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Season", "tags": [],
         "category_id": None, "payload": {"var_binding": "season", "options": [
             {"id": "s1", "value": "winter", "weight": 1}]}},
        {"id": "aaaa0003", "type": "constraint", "name": "Season dress", "tags": [],
         "payload": {"source_wildcard_id": "aaaa0002", "target_wildcard_id": "aaaa0001",
                     "exceptions": []}},
    ]
    bundles = [{"id": "bbbb0001", "name": "Kit", "tags": [], "category_id": None,
                "children": [{"id": "aaaa0001", "type": "wildcard", "name": "Outfit"}]}]
    cats = [{"id": "clothes", "name": "Clothes", "color": "#ff0000", "icon": None,
             "sort_order": 0}]
    return chat.Library(modules, bundles, cats, [])


def test_update_many_moves_tags_and_rates_in_one_card():
    p = _lib().run("update_many", {"ids": ["aaaa0001", "Season", "bbbb0001", "nope"],
                                   "category": "Places", "tags_add": ["#Outdoor"],
                                   "rating": "nsfw"})
    op = p["op"]
    assert op["op"] == "bulk" and op["new_category"] == "Places"
    assert "risk" not in p  # many items at once never auto-apply
    by = {i["id"]: i for i in op["items"]}
    assert set(by) == {"aaaa0001", "aaaa0002", "bbbb0001"}
    assert by["aaaa0001"]["body"] == {"tags": ["fashion", "outdoor"], "category_id": None,
                                      "content_rating": "nsfw"}
    assert by["aaaa0001"]["to_new"] is True
    assert by["aaaa0001"]["before"]["category_id"] == "clothes"
    assert any("nope" in w for w in p["warnings"])


def test_update_many_clears_a_category_and_refuses_no_change():
    p = _lib().run("update_many", {"ids": ["aaaa0001", "aaaa0002"], "category": "none"})
    assert [i["id"] for i in p["op"]["items"]] == ["aaaa0001"]
    assert p["op"]["items"][0]["body"] == {"category_id": None}
    with pytest.raises(ValueError, match="say what to change"):
        _lib().run("update_many", {"ids": ["aaaa0001"]})
    with pytest.raises(ValueError, match="at most"):
        _lib().run("update_many", {"ids": [str(i) for i in range(chat_manage.MAX_BULK + 1)],
                                   "tags_add": ["x"]})


def test_categories_take_a_color_and_icon():
    p = _lib().run("edit_categories", {
        "create": [{"name": "Places", "color": "blue", "icon": "pi-map"}, "Moods"],
        "rename": [{"from": "Clothes", "color": "#00ff00", "icon": "pi pi-tag"}]})
    styles = p["op"]["styles"]
    assert styles[0]["name"] == "Places" and styles[0]["color"].startswith("#")
    assert styles[0]["icon"] == "map"
    clothes = next(s for s in styles if s.get("id") == "clothes")
    assert clothes["color"] == "#00ff00" and clothes["icon"] == "tag"
    assert clothes["before"] == {"color": "#ff0000", "icon": None}
    assert "risk" not in p  # restyling an existing category is a normal card
    with pytest.raises(ValueError, match="no category icon"):
        _lib().run("edit_categories", {"create": [{"name": "X", "icon": "brush"}]})
    low = _lib().run("edit_categories", {"create": [{"name": "Moods", "color": "red"}]})
    assert low["risk"] == "low"


def test_category_icons_match_the_editor_icon_catalog():
    src = (ROOT / "src/kit/icon-catalog.ts").read_text(encoding="utf-8")
    lists = re.findall(r"icons:\s*\[([^\]]*)\]", src)
    icons = [i for chunk in lists for i in re.findall(r'"([a-z0-9-]+)"', chunk)]
    assert icons == list(chat_manage.CATEGORY_ICONS)


def test_update_info_renames_and_clears_the_category():
    p = _lib().run("update_info", {"id": "aaaa0001", "name": "Outfits", "category": "none"})
    assert p["op"]["body"] == {"name": "Outfits", "category_id": None}
    assert p["op"]["before"] == {"name": "Outfit", "category_id": "clothes"}
    assert "risk" not in p  # a rename changes what people see
    q = _lib().run("update_info", {"id": "bbbb0001", "category": "Clothes"})
    assert q["op"]["kind"] == "bundle" and q["risk"] == "low"


def test_edit_groups_renames_switches_kind_and_ungroups():
    payload = _lib().modules["aaaa0001"]["payload"]
    out = ai_wildcard.edit_groups(payload, [{"group": "weather", "rename": "Climate",
                                             "kind": "accepts"}])
    assert out["payload"] == {"tag_groups": {"Climate": ["warm", "cold"]},
                              "tag_group_kinds": {"Climate": "accepts"}}
    gone = ai_wildcard.edit_groups(payload, [{"group": "Weather", "ungroup": True},
                                             {"group": "Nope"}])
    assert gone["payload"]["tag_groups"] == {} and any("Nope" in w for w in gone["warnings"])
    neg = ai_wildcard.edit_groups(payload, [{"group": "Weather", "rename": "neg"}])
    assert "reserved" in neg["warnings"][0]


def test_rename_option_tags_merges_and_drops_everywhere():
    payload = _lib().modules["aaaa0001"]["payload"]
    out = ai_wildcard.rename_option_tags(payload, [{"from": "#cold", "to": "warm"}], ["red"])
    p = out["payload"]
    assert p["sub_categories"] == ["warm"]
    assert [o["sub_categories"] for o in p["options"]] == [["warm"], ["warm"]]
    assert p["tag_groups"] == {"Weather": ["warm"]}
    assert "#cold → #warm (merge)" in out["preview"] and out["changed"] == ["cold", "red"]


def test_edit_options_groups_and_tag_renames_make_a_valid_card():
    p = _lib().run("edit_options", {"id": "aaaa0001",
                                    "groups": [{"group": "Weather", "rename": "Climate"}],
                                    "rename_tags": [{"from": "red", "to": "crimson"}]})
    payload = p["op"]["body"]["payload"]
    assert payload["tag_groups"] == {"Climate": ["warm", "cold"]}
    assert payload["sub_categories"] == ["warm", "cold", "crimson"]
    assert payload["options"][0]["sub_categories"] == ["cold", "crimson"]
    assert any("Season dress" in w for w in p["warnings"])


def _more():
    lib = _lib()
    lib.modules["dddd0001"] = {"id": "dddd0001", "type": "fixed_values", "name": "Base",
                               "tags": [], "payload": {"values": [
                                   {"id": "v1", "name": "style", "value": "oil painting",
                                    "negative": "photo"}]}}
    lib.modules["eeee0001"] = {"id": "eeee0001", "type": "derivation", "name": "Gear",
                               "tags": [], "payload": {"rules": [
                                   {"id": "r1", "branches": [{"condition": {
                                       "var": "outfit", "op": "equals", "value": "coat"},
                                       "action": {"target_var": "a", "mode": "replace",
                                                  "value": "x"}}]},
                                   {"id": "r2", "branches": [{"condition": {
                                       "var": "season", "op": "is_set", "value": ""},
                                       "action": {"target_var": "b", "mode": "replace",
                                                  "value": "y"}}]}]}}
    lib.modules["aaaa0009"] = {**lib.modules["aaaa0002"], "id": "aaaa0009", "name": "season "}
    return lib


def test_edit_values_changes_only_the_negative_or_only_the_text():
    p = _more().run("edit_values", {"id": "Base", "set": [{"name": "style",
                                                           "negative": "photo, 3d"}]})
    row = p["op"]["body"]["payload"]["values"][0]
    assert row == {"id": "v1", "name": "style", "value": "oil painting", "negative": "photo, 3d"}
    q = _more().run("edit_values", {"id": "Base", "set": [{"name": "style",
                                                           "value": "watercolor"}]})
    assert q["op"]["body"]["payload"]["values"][0]["negative"] == "photo"
    r = _more().run("edit_values", {"id": "Base", "set": [{"name": "style", "negative": ""}]})
    assert "negative" not in r["op"]["body"]["payload"]["values"][0]


def test_derivation_conditions_read_accessors_and_nest_groups():
    p = _more().run("add_rules", {"id": "Gear", "rules": [{"branches": [{
        "match": "all",
        "conditions": [{"var": "$outfit.neg", "op": "contains", "value": "blurry"},
                       {"match": "any", "conditions": [
                           {"var": "season", "op": "equals", "value": "winter"},
                           {"var": "outfit.0", "op": "is_empty"}]}],
        "actions": [{"target_var": "c", "mode": "replace", "value": "z"}]}]}]})
    rule = p["op"]["body"]["payload"]["rules"][-1]
    cond = rule["branches"][0]["condition"]
    assert cond["match"] == "all" and cond["conditions"][0]["var"] == "outfit.neg"
    assert cond["conditions"][1] == {"match": "any", "conditions": [
        {"var": "season", "op": "equals", "value": "winter"},
        {"var": "outfit.0", "op": "is_empty", "value": ""}]}


def test_edit_rules_moves_rules():
    p = _more().run("edit_rules", {"id": "Gear", "move": [{"n": 2, "to": 1}]})
    assert [r["id"] for r in p["op"]["body"]["payload"]["rules"]] == ["r2", "r1"]
    assert "Move rule 2 to place 1" in p["preview"]


def test_find_duplicates_marks_identical_sets():
    text = _more().run("find_duplicates", {})
    assert "same name, wildcard, identical content" in text
    assert "[[aaaa0002#Season]]" in text and "[[aaaa0009#season]]" in text
    assert _more().run("find_duplicates", {"type": "combine"}) == "no duplicates among combines"


def test_assistant_tools_page_lists_every_tool_once():
    from engine.ai import docs
    from engine.ai.tools import catalog

    text = docs.read("assistant-tools")
    for t in catalog.TOOLS:
        if t.name != "more_tools":
            assert f"- {t.name}: " in text
    assert text.count("- update_many: ") == 1
    assert "assistant-tools" in docs.contents()
    assert "assistant-tools" in docs.search("assistant tools by job")
