"""Answer ↔ card checks: what a chat answer says its cards do."""
from __future__ import annotations

import pytest

from engine.ai import claims
from engine.ai import request_check as rc


def _delete(type_="wildcard"):
    return {"tool": "delete_items", "op": {"op": "delete", "kind": "delete", "items": [
        {"kind": "module", "type": type_, "id": "a1", "name": "Hair colour"}]}}


def test_a_delete_answer_names_its_kind_without_a_create_note():
    # Bench W23 / F6: "(No wildcard card came with this answer…)" under a delete.
    msg = "I've proposed deleting the Hair colour wildcard."
    assert claims.missing_kinds(msg, [_delete()]) == []
    assert claims.missing_kinds("I've proposed removing the old combine.", [_delete()]) == []
    edit = {"tool": "edit_options", "op": {"op": "update", "type": "wildcard", "id": "w"}}
    assert claims.missing_kinds("I've added negatives to the Weather wildcard.", [edit]) == []
    # A real false claim still counts.
    assert claims.missing_kinds("I've created a combine for the face.", [edit]) == ["combine"]


def test_request_gaps_skip_answers_that_only_delete_or_tidy():
    # Bench X7: "Delete the Mood → weather constraint" asks for no constraint.
    assert rc.gaps("Delete the Mood → weather constraint", [_delete("constraint")]) == []
    tidy = {"tool": "update_many", "op": {"op": "bulk"}}
    assert rc.gaps("never rain with snow; tag these", [tidy]) == []


def _options(*opts, tool="edit_options"):
    return {"tool": tool, "preview": [], "op": {"op": "update", "type": "wildcard", "body": {
        "payload": {"options": list(opts)}}, "before": {"payload": {"options": []}}}}


def test_weights_the_answer_names_must_be_on_a_card():
    # Bench W13: "heterochromia is at weight 0.5" with no weight on the card.
    card = _options({"value": "heterochromia"})
    assert claims.unbacked_numbers("Heterochromia is at weight 0.5, so it is rare.",
                                   [card]) == ["0.5"]
    weighted = _options({"value": "heterochromia", "weight": 0.5})
    assert claims.unbacked_numbers("Heterochromia is at weight 0.5.", [weighted]) == []
    # Test shares are percentages, not settings; weight 1 is every option's default.
    assert claims.unbacked_numbers("It came up at weight 28% in the test; others weight 1.",
                                   [card]) == []
    # X5: the reply says factor 0.1, the card boosts ×2.
    rule = {"tool": "edit_constraint", "preview": ["dwarf → mage: boost ×2"],
            "op": {"op": "update", "body": {"payload": {"rules": [{"factor": 2}]}}}}
    assert claims.unbacked_numbers("Dwarves can be mages again, boost factor 0.1.",
                                   [rule]) == ["0.1"]
    assert claims.unbacked_numbers("Mages get boosted ×2.", [rule]) == []
    # No card that could hold one: nothing to check.
    assert claims.unbacked_numbers("weight 3", [_delete()]) == []


def _bundle(before, after):
    return {"tool": "edit_bundle", "op": {
        "op": "update", "type": "bundle", "id": "b",
        "body": {"children": [{"id": i} for i in after]},
        "before": {"children": [{"id": i} for i in before]}}}


def test_a_move_the_bundle_card_does_not_make_is_flagged():
    # Bench B4: the accessory removed, Hair colour never moved.
    said = "Accessory is off and Hair colour now runs right after Race."
    assert claims.unbacked_move(said, [_bundle(["r", "c", "h", "a"], ["r", "c", "h"])])
    assert not claims.unbacked_move(said, [_bundle(["r", "c", "h"], ["r", "h", "c"])])
    assert not claims.unbacked_move("Accessory is off.", [_bundle(["a"], [])])
    assert not claims.unbacked_move(said, [_delete()])


def test_done_before_apply():
    assert claims.says_done("The Bench scene bundle has been created successfully!")
    assert claims.says_done("Weather is now part of your library.")
    assert not claims.says_done("Apply the card and Weather will be in your library.")


def test_tool_names_are_said_in_plain_words():
    names = ("edit_options", "run_test", "search", "update_many")
    assert claims.plain_tool_names("I'll use the edit_options tool to add them.", names) \
        == "I'll use an options change to add them."
    assert claims.plain_tool_names("Then `run_test` shows it.", names) \
        == "Then a test run shows it."
    # Plain words and code blocks stay.
    assert claims.plain_tool_names("I'll search your library.", names) \
        == "I'll search your library."
    code = "```\nedit_options\n```"
    assert claims.plain_tool_names(code, names) == code


def test_explain_asks_are_read_only():
    from engine.ai import chat
    assert chat.explain_ask('Explain this in simpler words: "Only makes the row…"')
    assert not chat.explain_ask("Explain how constraints work")
    from tests.engine.ai.test_ai_chat_tools import _lib
    lib = _lib()
    lib.read_only = True
    with pytest.raises(ValueError, match="only asked for an explanation"):
        lib.run("create_wildcard", {"name": "Hats", "var": "hat", "options": [{"text": "cap"}]})
    assert "Season" in lib.run("read", {"id": "Season"})
