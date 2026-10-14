"""engine/ai/chat.py — a new, never-saved item open in its editor.

The editor sends it under the id it reserved (`new: true` + `type`); the chat
reads it by that id, its changes to it go into the editor (`basis: editor`),
and nothing about it is created by the chat."""
from __future__ import annotations

from engine.ai import chat


def _lib() -> chat.Library:
    modules = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Outfit", "tags": [],
         "payload": {"var_binding": "outfit", "sub_categories": ["warm"], "options": [
             {"id": "o1", "value": "wool coat", "weight": 1, "sub_categories": ["warm"]},
             {"id": "o2", "value": "sundress", "weight": 1, "sub_categories": []},
         ]}},
    ]
    return chat.Library(modules, [], [])


NEW_WILDCARD = {
    "id": "feed0001", "new": True, "type": "wildcard", "name": "Weather",
    "description": "", "tags": [], "category_id": None, "content_rating": "safe",
    "dirty": True,
    "payload": {"var_binding": "weather", "sub_categories": ["wet"], "options": [
        {"id": "w1", "value": "rain", "weight": 1, "sub_categories": ["wet"]},
        {"id": "w2", "value": "sun", "weight": 1, "sub_categories": []},
    ]},
}


def test_new_item_is_readable_and_changes_go_into_the_editor():
    lib = _lib()
    lib.use_editor(dict(NEW_WILDCARD))
    assert lib.editor_id == "feed0001" and lib.editor_new
    text = lib.read({"id": "feed0001"})
    assert "rain" in text and "sun" in text
    # No route id on a new item's page: the note names it from the editor.
    note = lib.page_note({"route": "wildcards-new"})
    assert "new wildcard \"Weather\" (feed0001)" in note and "not saved yet" in note
    p = lib.run("add_options", {"id": "feed0001", "options": [{"text": "fog"}]})
    assert p["op"]["op"] == "update" and p["op"]["id"] == "feed0001"
    assert p["op"]["basis"] == "editor"
    assert [o["value"] for o in p["op"]["body"]["payload"]["options"]] == ["rain", "sun", "fog"]


def test_card_pointing_at_the_new_item_says_it_needs_saving():
    lib = _lib()
    lib.use_editor(dict(NEW_WILDCARD))
    p = lib.run("create_constraint", {
        "source_id": "feed0001", "target_id": "aaaa0001",
        "rules": [{"source": "#wet", "target": "#warm", "effect": "boost", "factor": 2}]})
    assert p["op"]["body"]["payload"]["source_wildcard_id"] == "feed0001"
    assert any("only once the user saves it" in w for w in p["warnings"])


def test_new_bundle_and_bad_new_editors():
    lib = _lib()
    lib.use_editor({"id": "feed0002", "new": True, "type": "bundle", "name": "Kit"})
    assert lib.bundles["feed0002"]["name"] == "Kit" and lib.editor_new
    assert "new bundle \"Kit\"" in lib.page_note({"route": "bundles-new"})
    # A saved item's id, a non-hex id, an unknown type or no `new` flag: ignored.
    for ed in ({"id": "aaaa0001", "new": True, "type": "wildcard", "name": "X"},
               {"id": "nothex!!", "new": True, "type": "wildcard"},
               {"id": "feed0003", "new": True, "type": "template"},
               {"id": "feed0004", "type": "wildcard"}):
        other = _lib()
        other.use_editor(ed)
        assert not other.editor_new
        assert other.get(ed["id"]) is None or ed["id"] == "aaaa0001"
    # A "new" editor claiming a saved item's id is just an ordinary open editor.
    same = _lib()
    same.use_editor({"id": "aaaa0001", "new": True, "type": "wildcard", "name": "X"})
    assert same.modules["aaaa0001"]["type"] == "wildcard" and not same.editor_new
