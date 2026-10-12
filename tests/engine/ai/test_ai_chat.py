"""engine/ai/chat.py — library tools and change proposals."""
from __future__ import annotations

import pytest

from engine.ai import chat


def _lib():
    modules = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Outfit", "tags": ["fashion"],
         "category_id": "c1", "updated_at": "2026-10-01",
         "payload": {"var_binding": "outfit", "sub_categories": ["warm"], "options": [
             {"id": "o1", "value": "wool coat", "weight": 1, "sub_categories": ["warm"]},
             {"id": "o2", "value": "sundress", "weight": 2, "sub_categories": []},
         ]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Season", "tags": [],
         "updated_at": "2026-10-02",
         "payload": {"var_binding": "season", "sub_categories": ["cold"], "options": [
             {"id": "s1", "value": "winter", "weight": 1, "sub_categories": ["cold"]},
             {"id": "s2", "value": "summer", "weight": 1, "sub_categories": []},
         ]}},
        {"id": "aaaa0003", "type": "derivation", "name": "Titles", "tags": [],
         "payload": {"rules": []}},
    ]
    bundles = [{"id": "bbbb0001", "name": "Kit", "tags": ["kit"],
                "children": [{"type": "wildcard", "name": "Outfit"}]}]
    return chat.Library(modules, bundles, [{"id": "c1", "name": "Characters"}])


def test_parse_args_and_step():
    assert chat.parse_args('{"id": "x"}') == {"id": "x"}
    assert chat.parse_args('```json\n{"id": "x"}\n```') == {"id": "x"}
    assert chat.parse_args('sure: {"id": "x"} ok') == {"id": "x"}
    assert chat.parse_args({"id": "x"}) == {"id": "x"}
    assert chat.parse_args("") == {}
    with pytest.raises(ValueError):
        chat.parse_args("[1]")
    msg, calls = chat.parse_step({"message": " hi ", "calls": [
        {"tool": "read", "args": "{}"}, {"tool": "rm -rf", "args": ""}]})
    assert msg == "hi" and calls == [{"tool": "read", "args": "{}"}]
    with pytest.raises(ValueError):
        chat.parse_step("nope")


def test_turns_and_history():
    turns = chat.parse_turns([
        {"role": "user", "content": "a"}, {"role": "assistant", "content": "b"},
        {"role": "user", "content": "c"},
    ])
    assert chat.history_pairs(turns) == [("a", {"message": "b", "calls": []})]
    for bad in ([], [{"role": "assistant", "content": "x"}], [{"role": "user", "content": 1}],
                [{"role": "user", "content": "  "}]):
        with pytest.raises(ValueError):
            chat.parse_turns(bad)


def test_overview_search_read_variables():
    lib = _lib()
    over = lib.overview()
    assert "Categories: Characters" in over and "aaaa0001 · wildcard · Outfit · $outfit" in over
    assert "1 bundle" in over and "bbbb0001 · bundle · Kit" in over
    assert "2 matches" in lib.search({"query": "", "type": "wildcard"})
    hit = lib.search({"tag": "#fashion"})
    assert "Outfit" in hit and "category Characters" in hit
    assert lib.search({"query": "zzz"}) == "no matches"
    text = lib.read({"id": "aaaa0001"})
    assert "Variable: $outfit" in text and "- wool coat  [#warm]" in text and "×2" in text
    assert "Kit" in lib.read({"id": "bbbb0001"})
    with pytest.raises(ValueError):
        lib.read({"id": "nope"})
    assert "$season" in lib.variables({})
    assert 'Outfit" (aaaa0001) open' in lib.page_note({"route": "edit", "id": "aaaa0001"})
    assert lib.page_note({"route": "bundles"}) == "(The user is on the bundles page.)"


def test_create_wildcard_proposal():
    lib = _lib()
    p = lib.run("create_wildcard", {
        "name": "Hair", "var": "$hair", "category": "Looks", "tags": ["Fashion", "new one"],
        "options": [{"text": "red hair", "tags": ["warm"]}, {"text": "red hair"},
                    {"text": "a $b"}],
    })
    assert p["pid"] == "p1" and p["after"] is None and p["tool"] == "create_wildcard"
    op = p["op"]
    assert op["op"] == "create" and op["new_category"] == "Looks"
    body = op["body"]
    assert body["type"] == "wildcard" and body["category_id"] is None
    assert body["tags"] == ["fashion", "new one"]
    assert body["payload"]["var_binding"] == "hair"
    assert [o["value"] for o in body["payload"]["options"]] == ["red hair"]
    assert len(body["payload"]["options"][0]["id"]) == 8
    assert any("duplicate" in w for w in p["warnings"])
    clash = lib.run("create_wildcard", {"name": "O", "var": "outfit", "category": "characters",
                                        "options": [{"text": "x"}]})
    assert clash["op"]["body"]["category_id"] == "c1"
    assert any("already set" in w for w in clash["warnings"])
    with pytest.raises(ValueError):
        lib.run("create_wildcard", {"name": "Bad", "var": "1x", "options": [{"text": "a"}]})
    with pytest.raises(ValueError):
        lib.run("create_wildcard", {"name": "Empty", "var": "e", "options": []})


def test_changes_to_one_item_build_on_each_other():
    lib = _lib()
    first = lib.run("add_options", {"id": "aaaa0001", "options": [{"text": "raincoat"}]})
    assert first["op"]["before"]["payload"]["options"][-1]["value"] == "sundress"
    second = lib.run("add_options", {"id": "aaaa0001", "options": [
        {"text": "raincoat"}, {"text": "parka"}]})
    assert second["after"] == first["pid"]
    values = [o["value"] for o in second["op"]["body"]["payload"]["options"]]
    assert values == ["wool coat", "sundress", "raincoat", "parka"]
    assert second["op"]["before"]["payload"]["options"][-1]["value"] == "raincoat"
    assert "apply that one first" in second["warnings"][0]
    with pytest.raises(ValueError):
        lib.run("add_options", {"id": "aaaa0003", "options": [{"text": "x"}]})


def test_rules_constraint_info_open():
    lib = _lib()
    rule = {"summary": "winter coats", "branches": [{
        "match": "all", "conditions": [{"var": "season", "op": "equals", "value": "Winter"}],
        "actions": [{"target_var": "outfit", "mode": "append", "value": ", scarf"}]}]}
    d = lib.run("create_derivation", {"name": "Cold", "rules": [rule]})
    assert d["op"]["body"]["payload"]["rules"][0]["branches"][0]["condition"]["value"] == "winter"
    added = lib.run("add_rules", {"id": "aaaa0003", "rules": [rule]})
    assert added["summary"] == "0 → 1 rules"
    c = lib.run("create_constraint", {"source_id": "aaaa0002", "target_id": "aaaa0001", "rules": [
        {"source": "#cold", "target": "sundress", "effect": "exclude", "reason": "cold"},
        {"source": "#cold", "target": "#warm", "effect": "boost", "factor": 3},
    ]})
    payload = c["op"]["body"]["payload"]
    assert payload["matrix"] == {"cold": {"warm": {"mode": "boost", "factor": 3}}}
    assert payload["exceptions"][0]["target_id"] == "o2"
    assert c["op"]["body"]["name"] == "Season → Outfit"
    with pytest.raises(ValueError):
        lib.run("create_constraint", {"source_id": "aaaa0001", "target_id": "aaaa0001",
                                      "rules": []})
    info = lib.run("update_info", {"id": "aaaa0001", "tags_add": ["#Cozy"],
                                   "tags_remove": ["FASHION"], "category": "Gear",
                                   "rating": "nsfw"})
    op = info["op"]
    assert op["body"]["tags"] == ["cozy"] and op["before"]["tags"] == ["fashion"]
    assert op["body"]["category_id"] is None and op["new_category"] == "Gear"
    assert op["body"]["content_rating"] == "nsfw"
    with pytest.raises(ValueError):
        lib.run("update_info", {"id": "bbbb0001", "tags_add": ["kit"]})
    o = lib.run("open", {"id": "bbbb0001"})
    assert o["op"] == {"op": "open", "kind": "bundle", "type": "bundle", "id": "bbbb0001"}
    with pytest.raises(ValueError):
        lib.run("delete_everything", {})


def test_args_note():
    assert chat.args_note("search", {"query": "coat", "tag": "warm"}) == \
        'Searched "coat" tagged #warm'
    assert chat.args_note("read", {"id": "aaaa0001"}) == "Read aaaa0001"
