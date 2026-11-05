"""engine/ai/chat.py — answers name items as [[id#Name]] chips, by id."""
from __future__ import annotations

from engine.ai import chat


def _w(iid, name, var):
    return {"id": iid, "type": "wildcard", "name": name, "tags": [],
            "payload": {"var_binding": var, "options": [{"id": "o1", "value": "x",
                                                         "weight": 1}]}}


def _lib():
    modules = [_w("aaaa0001", "Weapon", "weapon"), _w("aaaa0002", "Hair", "hair"),
               _w("aaaa0003", "Hair", "hair_alt"), _w("aaaa0004", "Class", "class"),
               {"id": "cccc0001", "type": "constraint", "name": "Class weapons", "tags": [],
                "payload": {"source_wildcard_id": "aaaa0004",
                            "target_wildcard_id": "aaaa0001", "exceptions": []}}]
    return chat.Library(modules, [], [], [])


def test_ids_and_names_become_id_chips():
    lib = _lib()
    out = lib.link_items("Use **Weapon** (aaaa0001) and Class wildcard (aaaa0004).")
    assert out == "Use [[aaaa0001#Weapon]] and [[aaaa0004#Class]] wildcard."
    assert lib.link_items("ids: `aaaa0001`, aaaa0004") == \
        "ids: [[aaaa0001#Weapon]], [[aaaa0004#Class]]"
    assert lib.link_items("[[Weapon]] and [[aaaa0004#Wrong name]]") == \
        "[[aaaa0001#Weapon]] and [[aaaa0004#Class]]"
    assert lib.link_items("**Class** → **Weapon**") == "[[cccc0001#Class weapons]]"
    # Code blocks stay as written.
    assert lib.link_items("```\naaaa0001\n```") == "```\naaaa0001\n```"


def test_namesakes_link_by_variable_or_what_was_read():
    lib = _lib()
    assert lib.link_items("**Hair** (`$hair_alt`)").startswith("[[aaaa0003#Hair]]")
    # Unsure: left as written.
    assert lib.link_items("**Hair**") == "**Hair**"
    lib.touched.append("aaaa0002")
    assert lib.link_items("**Hair**") == "[[aaaa0002#Hair]]"


def test_message_refs_mark_shared_names_and_proposed_items():
    lib = _lib()
    refs = lib.message_refs("[[aaaa0001#Weapon]] [[Hair]] [[Nope]]")
    assert refs["aaaa0001#Weapon"] == {"id": "aaaa0001", "type": "wildcard", "name": "Weapon"}
    assert refs["Hair"] == {"id": "", "type": "", "name": "Hair", "shared": "2"}
    assert "Nope" not in refs
    lib.adopt_earlier({"pid": "p1", "op": {"op": "create", "kind": "module", "body": {
        "id": "dddd0001", "type": "wildcard", "name": "Armor",
        "payload": {"var_binding": "armor", "options": []}}}})
    refs = lib.message_refs("[[dddd0001#Armor]]")
    assert refs["dddd0001#Armor"]["pending"] == "p1"


def test_an_edit_of_an_unapplied_card_replaces_it_at_the_same_id():
    lib = _lib()
    lib.adopt_earlier({"pid": "p1", "title": "Create wildcard Armor", "op": {
        "op": "create", "kind": "module", "new_category": "", "body": {
            "id": "dddd0001", "type": "wildcard", "name": "Armor",
            "payload": {"var_binding": "armor", "options": [
                {"id": "a1", "value": "plate", "weight": 1}]}}}})
    p = lib.run("add_options", {"id": "dddd0001", "options": [{"text": "leather"}]})
    assert p["replaces"] == "p1" and p["op"]["op"] == "create"
    assert p["op"]["body"]["id"] == "dddd0001"
    assert [o["value"] for o in p["op"]["body"]["payload"]["options"]] == ["plate", "leather"]
    assert lib.earlier_proposals["p1"]["status"] == "replaced"
    assert not any("earlier card" in w for w in p["warnings"])


def test_warnings_that_only_inform_are_notes_without_ask_to_fix():
    lib = _lib()
    # A change waiting on a card this answer can't fold into.
    lib._pending["aaaa0001"] = ("p9", lib.get("aaaa0001"))
    p = lib.run("edit_options", {"id": "aaaa0001", "weights": [{"n": 1, "weight": 2}]})
    first = p["warnings"][0]
    assert first.startswith("Builds on the earlier change")
    assert p["notes"] == [first]


def test_names_in_code_spans_become_chips():
    """#2: `[[Name]]` and `Name` in backticks stayed plain code."""
    lib = _lib()
    assert lib.link_items("Open `[[Weapon]]` or `Class`.") == \
        "Open [[aaaa0001#Weapon]] or [[aaaa0004#Class]]."
    # Two items share it, or it names none: left as written.
    assert lib.link_items("`Hair` and `$weapon`") == "`Hair` and `$weapon`"


def test_message_refs_carry_the_category():
    modules = [{**_w("aaaa0001", "Weapon", "weapon"), "category_id": "cat1"}]
    refs = chat.Library(modules, [], [], []).message_refs("[[aaaa0001#Weapon]]")
    assert refs["aaaa0001#Weapon"]["category"] == "cat1"
