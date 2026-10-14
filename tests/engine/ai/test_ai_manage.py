"""engine/ai/chat_manage.py — categories, tags and deleting from the chat."""
from __future__ import annotations

import pytest

from engine.ai import chat, chat_manage


def _lib(allow_delete=True):
    modules = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Outfit", "tags": ["fashion", "warm"],
         "category_id": "clothes", "payload": {"var_binding": "outfit", "options": [
             {"id": "o1", "value": "coat", "weight": 1}]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Season", "tags": ["warm"],
         "category_id": None, "payload": {"var_binding": "season", "options": [
             {"id": "s1", "value": "winter", "weight": 1}]}},
        {"id": "aaaa0003", "type": "constraint", "name": "Season dress", "tags": [],
         "payload": {"source_wildcard_id": "aaaa0002", "target_wildcard_id": "aaaa0001",
                     "exceptions": []}},
    ]
    bundles = [{"id": "bbbb0001", "name": "Kit", "tags": ["fashion"], "category_id": "clothes",
                "children": [{"id": "aaaa0001", "type": "wildcard", "name": "Outfit"}]}]
    templates = [{"id": "cccc0001", "name": "Portrait", "tags": [], "category_id": "clothes",
                  "template_string": "$outfit"}]
    cats = [{"id": "clothes", "name": "Clothes", "color": "#f00", "icon": None, "sort_order": 2},
            {"id": "places", "name": "Places", "color": None, "icon": None, "sort_order": 0}]
    lib = chat.Library(modules, bundles, cats, templates)
    lib.allow_delete = allow_delete
    return lib


def test_delete_is_refused_while_the_setting_is_off():
    with pytest.raises(ValueError, match="turned off"):
        _lib(allow_delete=False).run("delete_items", {"items": ["Outfit"]})


def test_delete_card_holds_what_undo_needs_and_warns_about_users():
    p = _lib().run("delete_items", {"items": ["Outfit", "aaaa0001", "Portrait"],
                                    "categories": ["clothes"], "tags": ["#Warm"]})
    op = p["op"]
    assert op["op"] == "delete" and "risk" not in p
    assert [(i["kind"], i["id"]) for i in op["items"]] == [("module", "aaaa0001"),
                                                          ("template", "cccc0001")]
    assert op["items"][0]["row"]["payload"]["options"][0]["value"] == "coat"
    # Members the delete takes with it aren't restored twice.
    assert op["categories"] == [{"id": "clothes", "name": "Clothes", "color": "#f00",
                                 "icon": None, "sort_order": 2,
                                 "members": [{"kind": "bundle", "id": "bbbb0001"}]}]
    assert op["tags"] == [{"tag": "warm", "members": [
        {"kind": "module", "id": "aaaa0002", "tags": ["warm"]}]}]
    assert p["title"] == "Delete 4 things"
    assert any("Outfit is used by" in w and "Season dress" in w and "Kit" in w
               for w in p["warnings"])
    assert any("1 item loses the category Clothes" in w for w in p["warnings"])


def test_delete_limits_and_unknowns():
    lib = _lib()
    with pytest.raises(ValueError, match="at most 10"):
        lib.run("delete_items", {"items": [f"x{i}" for i in range(11)]})
    with pytest.raises(ValueError, match="no category"):
        lib.run("delete_items", {"categories": ["Nope"]})
    with pytest.raises(ValueError, match="no library tag"):
        lib.run("delete_items", {"tags": ["nope"]})
    with pytest.raises(ValueError, match="name the items"):
        lib.run("delete_items", {})


def test_an_item_proposed_in_this_answer_cant_be_deleted():
    lib = _lib()
    lib.run("create_wildcard", {"name": "Hat", "var": "hat", "options": [{"text": "cap"}]})
    with pytest.raises(ValueError, match="only a proposal"):
        lib.run("delete_items", {"items": ["Hat"]})


def test_edit_categories_creates_are_low_risk_renames_are_not():
    lib = _lib()
    p = lib.run("edit_categories", {"create": ["Weather", "places", "Weather", "!!"]})
    assert p["op"] == {"op": "categories", "kind": "categories", "create": ["Weather"],
                       "rename": []}
    assert p["risk"] == "low" and "places exists already" in p["warnings"]
    p = lib.run("edit_categories", {"rename": [{"from": "Clothes", "to": "Outfits"}]})
    assert p["op"]["rename"] == [{"id": "clothes", "from": "Clothes", "to": "Outfits"}]
    assert "risk" not in p
    with pytest.raises(ValueError, match="changes nothing"):
        lib.run("edit_categories", {"rename": [{"from": "Clothes", "to": "Places"}]})


def test_edit_tags_rename_and_merge_keep_each_items_tags_for_undo():
    p = _lib().run("edit_tags", {"rename": [{"from": "#warm", "to": "Fashion"}]})
    (r,) = p["op"]["rename"]
    assert r["from"] == "warm" and r["to"] == "fashion" and r["merge"] is True
    assert r["members"] == [{"kind": "module", "id": "aaaa0001", "tags": ["fashion", "warm"]},
                            {"kind": "module", "id": "aaaa0002", "tags": ["warm"]}]
    assert p["title"] == "Rename and merge tags" and p["summary"] == "2 items"
    with pytest.raises(ValueError, match="no library tag"):
        _lib().run("edit_tags", {"rename": [{"from": "nope", "to": "x"}]})


def test_a_big_tag_rename_is_refused(monkeypatch):
    monkeypatch.setattr(chat_manage, "MAX_TAG_ITEMS", 1)
    with pytest.raises(ValueError, match="touches 2 items"):
        _lib().run("edit_tags", {"rename": [{"from": "warm", "to": "hot"}]})


def test_update_info_is_low_risk_unless_it_changes_the_rating():
    lib = _lib()
    assert lib.run("update_info", {"id": "Season", "tags_add": ["cold"]})["risk"] == "low"
    assert "risk" not in lib.run("update_info", {"id": "Outfit", "rating": "nsfw"})
