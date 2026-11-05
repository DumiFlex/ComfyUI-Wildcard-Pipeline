"""Step grammars narrowed to what exists and may be changed
(`engine/ai/narrow.py`, /pr-drafts/request-aware-prompts-plan.md Phase 2)."""
from __future__ import annotations

import json

from engine.ai import chat as ai_chat
from engine.ai import narrow
from engine.ai import tools as ai_tools


def _lib():
    mods = [
        {"id": "aaaa0001", "type": "wildcard", "name": "Colors", "var_binding": "color",
         "payload": {"options": [{"id": "o1", "value": "red", "weight": 1}]}},
        {"id": "aaaa0002", "type": "wildcard", "name": "Weather", "var_binding": "weather",
         "payload": {"options": [{"id": "o2", "value": "rain", "weight": 1}]}},
        {"id": "aaaa0003", "type": "derivation", "name": "Cloaks", "var_binding": "",
         "payload": {"rules": []}},
    ]
    tpl = [{"id": "tttt0001", "name": "Portrait", "template_string": "$color"}]
    lib = ai_chat.Library(mods, [], [], tpl)
    lib.named = {"aaaa0001"}
    return lib


def _prop(tool, field):
    return (tool.params.get("properties") or {}).get(field) or {}


def test_item_tools_name_only_what_the_edit_guard_allows():
    lib = _lib()
    got = {t.name: t for t in narrow.narrow(ai_tools.tools(
        ["read", "add_options", "edit_options", "edit_rules", "update_info", "search"]), lib)}
    assert _prop(got["edit_options"], "id")["enum"] == ["aaaa0001"]
    assert _prop(got["update_info"], "id")["enum"] == ["aaaa0001"]
    assert "edit_rules" not in got  # no derivation the user named
    assert _prop(got["read"], "id")["enum"] == ["aaaa0001", "aaaa0002", "aaaa0003", "tttt0001"]
    assert "enum" not in json.dumps(got["search"].params)
    # The catalog's own schema is untouched (prompt, native, check_args).
    assert "enum" not in json.dumps(ai_tools.BY_NAME["edit_options"].params)


def test_reads_on_a_change_ask_and_the_page_item_widen_it():
    lib = _lib()
    lib.touched = ["aaaa0003"]
    lib.edit_read = True
    lib.editor_id = "aaaa0002"
    assert narrow.editable(lib) == {"aaaa0001", "aaaa0002", "aaaa0003"}
    lib.edit_read = False
    assert "aaaa0003" not in narrow.editable(lib)
    lib.named = None
    assert narrow.editable(lib) is None
    assert "edit_options" not in narrow.enums(lib)


def test_static_fields_and_optional_ones_that_allow_nothing():
    lib = _lib()
    [op] = narrow.narrow(ai_tools.tools(["open"]), lib)
    assert "ai" in _prop(op, "section")["enum"] and "settings" in _prop(op, "page")["enum"]
    [rt] = narrow.narrow(ai_tools.tools(["run_test"]), lib)
    assert _prop(rt, "template")["enum"] == ["tttt0001"]
    lib.templates = {}
    [rt] = narrow.narrow(ai_tools.tools(["run_test"]), lib)
    assert "template" not in rt.params["properties"]
    assert rt.params["required"] == ["stack"]


def test_never_empties_the_offer_and_skips_long_lists(monkeypatch):
    lib = _lib()
    lib.named = set()
    offer = ai_tools.tools(["edit_rules"])
    assert narrow.narrow(offer, lib) == offer
    monkeypatch.setattr(narrow, "MAX_ENUM", 2)
    assert "read" not in narrow.enums(lib)


def test_what_follows_a_call():
    assert narrow.next_tools({"search"}, set()) == {"read"}
    assert narrow.next_tools({"create_wildcard"}, {"derivation"}) == {
        "run_test", "add_rules", "edit_rules"}
    assert "create_constraint" in narrow.next_tools(set(), {"wildcard"})
    assert narrow.next_tools({"read"}, set()) == set()
