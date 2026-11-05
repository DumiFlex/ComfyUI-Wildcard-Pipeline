"""Gaps the feature audit found (/pr-drafts/ai-feature-audit.md): sub-bundles,
renaming a module's variable, reordering options, readers of a variable,
moving a constraint, the page tools use_panel / show_test, and the warnings
the model now reads back."""
from __future__ import annotations

import pytest

from engine.ai import chat, client_tools
from tests.engine.ai.test_ai_chat_tools import _lib


def _with_bundles():
    lib = _lib()
    inner = {"id": "bbbb0002", "name": "Scene", "tags": [], "children": [
        {"id": "aaaa0002", "type": "wildcard", "enabled": True, "meta": {"name": "Season"},
         "payload": lib.modules["aaaa0002"]["payload"], "instance": {}}]}
    nested = {"id": "bbbb0003", "name": "Outer", "tags": [], "children": [
        {"id": "bbbb0002", "type": "bundle", "enabled": True}]}
    return chat.Library(list(lib.modules.values()),
                        [*lib.bundles.values(), inner, nested], [],
                        list(lib.templates.values()))


def test_read_names_a_sub_bundle_and_lists_its_items():
    out = _with_bundles().read({"id": "bbbb0003"})
    assert "1. bundle Scene [[bbbb0002#Scene]] (sub-bundle)" in out
    assert "   - wildcard Season" in out


def test_bundles_nest_one_level_only():
    lib = _with_bundles()
    p = lib.run("create_bundle", {"name": "Big", "items": ["Outer", "Scene", "Look"]})
    ids = [c["id"] for c in p["op"]["body"]["children"]]
    assert "bbbb0003" not in ids and "bbbb0002" in ids
    assert any("nest one level" in w for w in p["warnings"])
    # Scene sits inside Outer, so Scene can't get a sub-bundle.
    with pytest.raises(ValueError):
        lib.run("edit_bundle", {"id": "Scene", "add": ["Kit"]})


def test_sub_bundle_keeps_its_place():
    lib = _with_bundles()
    p = lib.run("create_bundle", {"name": "Big", "items": ["Look", "Scene", "Quality"]})
    kinds = [c["type"] for c in p["op"]["body"]["children"]]
    assert kinds.index("bundle") == 1


def test_bundle_children_off_and_on():
    p = _lib().run("edit_bundle", {"id": "Kit", "off": [2]})
    assert p["op"]["body"]["children"][1]["enabled"] is False
    assert "Off: wildcard Outfit" in p["preview"]


def test_switch_off_asked_is_never_a_removal():
    # Bench B4: "switch off the accessory" removed it, both runs.
    lib = _lib()
    lib.user_text = "Switch off the outfit in Kit."
    p = lib.run("edit_bundle", {"id": "Kit", "remove": [2]})
    kids = p["op"]["body"]["children"]
    assert len(kids) == 2 and kids[1]["enabled"] is False
    assert any("Switched off, not removed" in w for w in p["warnings"])
    lib.user_text = "Remove the outfit from Kit."
    assert len(lib.run("edit_bundle", {"id": "Kit", "remove": [2]})["op"]["body"]["children"]) == 1


def test_bundle_move_after_and_before():
    # Bench B4: "move hair colour right after race" had no op and never happened.
    lib = _lib()
    old = [c["id"] for c in lib.bundles["bbbb0001"]["children"]]
    p = lib.run("edit_bundle", {"id": "Kit", "move": [{"item": 1, "after": 2}]})
    assert [c["id"] for c in p["op"]["body"]["children"]] == [old[1], old[0]]
    assert p["preview"][0].startswith("Moved: ")
    q = _lib().run("edit_bundle", {"id": "Kit", "move": [{"item": "Outfit", "before": "1"}]})
    assert [c["id"] for c in q["op"]["body"]["children"]] == [old[1], old[0]]
    with pytest.raises(ValueError, match="changes nothing"):
        _lib().run("edit_bundle", {"id": "Kit", "move": [{"item": 1, "after": 1}]})


def test_edit_options_moves_and_renames_the_variable():
    lib = _lib()
    p = lib.run("edit_options", {"id": "Outfit", "move": [{"n": 3, "to": 1}]})
    assert [o["id"] for o in p["op"]["body"]["payload"]["options"]] == ["o3", "o1", "o2"]
    q = _lib().run("edit_options", {"id": "Outfit", "var": "clothes"})
    assert q["op"]["body"]["payload"]["var_binding"] == "clothes"
    # The combine Look reads $outfit and would get nothing.
    assert any("Still read as $outfit" in w and "Look" in w for w in q["warnings"])
    with pytest.raises(ValueError):
        _lib().run("edit_options", {"id": "Outfit", "var": "two words"})


def test_variables_lists_who_sets_and_reads_one():
    out = _lib().run("variables", {"var": "$season"})
    assert "Set by: [[aaaa0002#Season]]" in out
    assert "Read by:" in out and "Look" in out and "Extras" in out
    assert _lib().run("variables", {"var": "nobody"}) == "nothing sets or reads $nobody"


def test_rename_a_fixed_value_and_a_combine_variable():
    p = _lib().run("edit_values", {"id": "Quality", "rename": [{"from": "quality",
                                                                  "to": "quality_tags"}]})
    assert p["op"]["body"]["payload"]["values"][0]["name"] == "quality_tags"
    assert any("Portrait" in w for w in p["warnings"])
    c = _lib().run("edit_combine", {"id": "Look", "var": "style"})
    assert c["op"]["body"]["payload"]["output_var"] == "style"
    assert c["preview"][0] == "Sets $style instead of $look"


def test_edit_constraint_points_at_another_wildcard():
    p = _lib().run("edit_constraint", {"id": "aaaa0004", "target_id": "Colors"})
    body = p["op"]["body"]["payload"]
    assert body["target_wildcard_id"] == "aaaa0007"
    # #cold → #warm: Colors has #warm, so the cell stays.
    assert body["matrix"] == {"cold": {"warm": {"mode": "boost", "factor": 3}}}
    q = _lib().run("edit_constraint", {"id": "aaaa0004", "source_id": "Colors"})
    assert q["op"]["body"]["payload"]["matrix"] == {}
    assert any("dropped" in w for w in q["warnings"])
    with pytest.raises(ValueError):
        _lib().run("edit_constraint", {"id": "aaaa0004", "source_id": "Outfit"})


def test_use_panel_checks_the_panel_fits_the_item():
    lib = _lib()
    args, label = client_tools.prepare(lib, "use_panel", {
        "id": "Outfit", "panel": "Rewrite", "request": "make them shorter"})
    assert args == {"id": "aaaa0001", "type": "wildcard", "panel": "rewrite",
                    "request": "make them shorter"}
    assert label == "Asked Rewrite in Outfit"
    assert client_tools.prepare(lib, "use_panel", {
        "id": "Look", "panel": "draft", "request": "warmer words"})[1] == \
        "Asked Draft with AI in Look"
    with pytest.raises(ValueError, match="no add panel"):
        client_tools.prepare(lib, "use_panel", {"id": "Look", "panel": "add",
                                                "request": "more"})


def test_show_test_takes_seeds_pins_output_and_save():
    args, label = client_tools.prepare(_lib(), "show_test", {
        "stack": ["Season", "Outfit"], "seeds": 30, "from": 100,
        "pins": {"$subject": "a knight"}, "output": "$outfit", "save": "Outfits",
        "run": False})
    assert args == {"stack": [{"module": "aaaa0002"}, {"module": "aaaa0001"}], "seeds": 30,
                    "from": 100, "pins": {"subject": "a knight"}, "output": "outfit",
                    "save": "Outfits", "run": False}
    assert label == "Set up 2 items in the Test Runner, saved as Outfits"


def test_the_model_reads_the_cards_warnings():
    lib = _lib()
    p = lib.run("create_wildcard", {"name": "Pose", "var": "pose", "options": [
        {"text": "standing"}, {"text": "close-up, sitting"}, {"text": "full body, kneeling"},
        {"text": "arms up"}]})
    note = chat.proposal_note("create_wildcard", p)
    assert "The card warns:" in note and "camera" in note
    assert "call the same tool again" in note


def test_bundle_use_names_options_by_number():
    lib = _lib()
    p = lib.run("edit_bundle", {"id": "Kit", "use": [{"n": 2, "use": "off options 1; pin 2"}]})
    inst = p["op"]["body"]["children"][1]["instance"]
    assert inst["enabled_options"] == ["o2", "o3"] and inst["pinned_option_id"] == "o2"
    assert "pin 2" in "".join(p["preview"])


def test_ollama_gets_reserved_parameter_names_aliased():
    from engine.ai.tools import BY_NAME, registry
    [tool] = registry.native([BY_NAME["update_info"]], "ollama")
    props = tool["function"]["parameters"]["properties"]
    assert "description_" in props and "description" not in props
    [plain] = registry.native([BY_NAME["update_info"]], "openai")
    assert "description" in plain["function"]["parameters"]["properties"]
    args = {"id": "x", "description": "d", "items": [{"type": "wildcard"}]}
    there = registry.alias_args(args)
    assert there == {"id": "x", "description_": "d", "items": [{"type_": "wildcard"}]}
    assert registry.alias_args(there, back=True) == args


def test_web_search_joins_and_leaves_a_chat_with_the_setting():
    from engine.ai import tools as ai_tools
    names = ai_tools.toolset("dashboard", scoped=False, web=False)
    assert "web_search" not in names
    on = ai_tools.sync_delete(names, True, ai_tools.WEB)
    assert "web_search" in on and ai_tools.sync_delete(on, True, ai_tools.WEB) is on
    assert "web_search" not in ai_tools.sync_delete(on, False, ai_tools.WEB)
    assert "without being asked" in ai_tools.BY_NAME["web_search"].summary


def test_a_new_bundle_nests_in_a_bundle_from_the_same_answer():
    lib = _lib()
    inner = lib.run("create_bundle", {"name": "Inner", "items": ["Season", "Outfit"]})
    iid = inner["op"]["body"]["id"]
    assert len(iid) == 8 and iid not in ("p1",)
    outer = lib.run("create_bundle", {"name": "Outer2", "items": ["Inner", "Look"]})
    assert outer["op"]["body"]["children"][0]["id"] == iid
    assert outer["after"] == inner["pid"]
    tpl = lib.run("create_template", {"name": "Shot", "template": "$season"})
    assert len(tpl["op"]["body"]["id"]) == 8


def test_off_ask_needs_an_off_word():
    from engine.ai.chat_tools import _OFF_ASK
    assert _OFF_ASK.search("mute the accessory") and _OFF_ASK.search("disable it")
    assert not _OFF_ASK.search("remove the mutual friends option")
