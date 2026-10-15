"""engine/ai/chat.py — library tools and change proposals."""
from __future__ import annotations

import pytest

from engine.ai import chat, client_tools


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
    assert "Variable: $outfit" in text and "1. wool coat  [#warm]" in text and "×2" in text
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
    assert client_tools.prepare(lib, "open", {"id": "bbbb0001"})[0] == {
        "id": "bbbb0001", "type": "bundle"}
    with pytest.raises(ValueError):
        lib.run("delete_everything", {})


def test_args_note():
    assert chat.args_note("search", {"query": "coat", "tag": "warm"}) == \
        'Searched "coat" tagged #warm'
    assert chat.args_note("read", {"id": "aaaa0001"}) == "Read aaaa0001"


def test_edit_options_remove_rewrite_retag_weights():
    lib = _lib()
    # A constraint points at "wool coat", so removing it is refused.
    lib.modules["cccc0001"] = {"id": "cccc0001", "type": "constraint", "name": "c", "payload": {
        "source_wildcard_id": "aaaa0002", "target_wildcard_id": "aaaa0001", "matrix": {},
        "exceptions": [{"source": "winter", "target": "wool coat", "source_id": "s1",
                        "target_id": "o1", "mode": "boost", "factor": 2}]}}
    p = lib.run("edit_options", {
        "id": "aaaa0001", "remove": [1], "rewrite": [{"n": 2, "text": "summer dress"}],
        "retag": [{"n": 2, "tags": ["warm", "light"]}], "weights": [{"n": 1, "weight": 3}],
    })
    opts = p["op"]["body"]["payload"]["options"]
    assert [o["value"] for o in opts] == ["wool coat", "summer dress"]
    assert opts[0]["weight"] == 3 and opts[1]["sub_categories"] == ["warm", "light"]
    assert p["op"]["body"]["payload"]["sub_categories"] == ["warm", "light"]
    assert any("constraint points at it" in w for w in p["warnings"])
    assert p["op"]["before"]["payload"]["options"][1]["value"] == "sundress"
    assert "sundress → summer dress" in p["preview"]

    q = _lib().run("edit_options", {"id": "aaaa0001", "remove": [2, 9]})
    assert [o["value"] for o in q["op"]["body"]["payload"]["options"]] == ["wool coat"]
    with pytest.raises(ValueError, match="changes nothing"):
        _lib().run("edit_options", {"id": "aaaa0001", "weights": [{"n": 2, "weight": 2}]})
    with pytest.raises(ValueError):
        _lib().run("edit_options", {"id": "aaaa0001", "rewrite": [{"n": 1, "text": "a $b"}]})


def test_editor_version_and_page_note():
    lib = _lib()
    lib.use_editor({"id": "aaaa0001", "name": "Outfits", "dirty": True, "payload": {
        "var_binding": "outfit", "sub_categories": ["warm"], "options": [
            {"id": "o1", "value": "wool coat", "weight": 1, "sub_categories": ["warm"]},
            {"id": "o9", "value": "raincoat", "weight": 1, "sub_categories": []},
        ]}})
    assert "2. raincoat" in lib.read({"id": "aaaa0001"})
    note = lib.page_note({"route": "wildcards-edit", "id": "aaaa0001", "note": "x" * 3000})
    assert "unsaved changes" in note and "On screen:" in note and len(note) < 1700
    p = lib.run("add_options", {"id": "aaaa0001", "options": [{"text": "parka"}]})
    assert p["op"]["basis"] == "editor"
    assert [o["value"] for o in p["op"]["body"]["payload"]["options"]][:2] == [
        "wool coat", "raincoat"]
    # Other items still save to the library.
    assert "basis" not in lib.run("update_info", {"id": "aaaa0002", "description": "d"})["op"]
    # An editor for an unknown id is ignored.
    other = _lib()
    other.use_editor({"id": "zzzz0000", "name": "x"})
    assert other.editor_id is None

    doc = chat.Library([], [], []).page_note({"route": "documentation-page", "doc": "combine"})
    assert '"Combine"' in doc and "docs_read" in doc


def test_docs_tools_and_open_targets():
    lib = _lib()
    found = lib.run("docs_search", {"query": "constraint target reach"})
    assert "constraint" in found and "›" in found
    text = lib.run("docs_read", {"page": "combine", "section": "per-use"})
    assert text.startswith("Combine (combine)") and "Template override" in text
    with pytest.raises(ValueError):
        lib.run("docs_read", {"page": "nope"})
    assert client_tools.prepare(lib, "open", {"doc": "combine"})[0] == {"doc": "combine"}
    page, label = client_tools.prepare(lib, "open", {"page": "settings", "section": "ai"})
    assert page == {"page": "settings", "section": "ai"} and label == "Opened settings › ai"
    for bad in ({"page": "nowhere"}, {"page": "settings", "section": "x"},
                {"page": "javascript:alert(1)"}, {"doc": "../../etc/passwd"}):
        with pytest.raises(ValueError):
            client_tools.prepare(lib, "open", bad)
    assert "Docs pages" in chat.system_prompt() and "- combine: Combine." in chat.system_prompt()
    assert chat.args_note("docs_read", {"page": "combine"}) == "Read the docs: Combine"


def test_stalls_spots_asking_leave_and_repeats():
    asked = "I'll create these. Should I proceed with creating these items?"
    assert chat.asks_leave(asked)
    assert chat.asks_leave("Would you like me to build it?")
    assert not chat.asks_leave("Here are three proposals.")
    assert chat.is_go_ahead("yes") and chat.is_go_ahead("ok, go ahead!")
    assert not chat.is_go_ahead("Medieval, with appearance, background, scene and poses")
    assert chat.stalls("Done thinking.", "yes", asked)
    assert not chat.stalls("Glad it helped.", "ok thanks", "Applied the change.")
    assert chat.stalls("Same answer again.", "hmm", "Same answer, again!")
    # A full answer that ends by offering more answered the question.
    long = "Here's what I found in your pose pools. " * 10 + "Want me to propose changes?"
    assert not chat.stalls(long, "what do my pose pools look like?", "")
    assert chat.unfinished("Here's a quick summary of the key concepts:")
    assert not chat.unfinished("Done: two cards.")
    assert chat.read_budget("small") < chat.read_budget("large")


def test_plan_pack_hands_the_description_to_the_pack_builder():
    lib = chat.Library([], [], [])
    out = lib.run("plan_pack", {"description": "  Medieval fantasy character pack  "})
    assert out["op"] == {"op": "open", "kind": "pack", "type": "pack", "id": "pack-builder",
                         "description": "Medieval fantasy character pack"}
    with pytest.raises(ValueError, match="describe the pack"):
        lib.run("plan_pack", {"description": "x"})
    assert "plan_pack" in chat.system_prompt(slim=True)


def _wc(id_, name, var, opts, tags=()):
    return {"id": id_, "type": "wildcard", "name": name, "description": "", "tags": list(tags),
            "payload": {"var_binding": var, "options": [
                {"id": f"o{i}", "value": v, "weight": 1} for i, v in enumerate(opts)]}}


def test_search_reads_content_and_widens_broad_subjects():
    lib = chat.Library([
        _wc("aaaa0001", "Waifus", "subject", [
            "roxy migurdia, long hair, blue hair, braid, blue eyes",
            "genshin lumine, blonde hair, yellow eyes, hair flower"]),
        _wc("aaaa0002", "Eye color", "eyes", ["blue eyes", "green eyes"]),
        _wc("aaaa0003", "Weather", "weather", ["rain", "snow"]),
    ], [], [])
    out = lib.search({"query": "characters"})
    assert "Weather" not in out
    assert "Waifus" in out and "Eye color" in out and "roxy migurdia" in out
    assert "matched in" in out
    # The query's own words beat widened ones; a name hit beats content.
    first = lib.search({"query": "lumine"}).splitlines()[1]
    assert "Waifus" in first
    assert lib.search({"query": "eye color"}).splitlines()[1].startswith("- aaaa0002")
    assert lib.search({"query": "zzz"}) == "no matches"
    assert "3 matches" in lib.search({"query": "", "type": "wildcard"})


def test_a_wildcard_with_no_variable_nothing_points_at_is_flagged():
    lib = _lib()
    p = lib.run("create_wildcard", {"name": "Pose", "var": "",
                                    "options": [{"text": "sitting"}, {"text": "standing"}]})
    assert any("sets no variable" in w for w in p["warnings"])
    p = lib.run("create_wildcard", {"name": "Pose", "var": "pose",
                                    "options": [{"text": "sitting"}, {"text": "standing"}]})
    assert not any("sets no variable" in w for w in p["warnings"])
