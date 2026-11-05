"""engine/ai/followup.py — conversation history for follow-ups."""
from __future__ import annotations

import pytest

from engine.ai import followup


def test_no_history_is_a_fresh_request():
    assert followup.parse_history(None) == []
    assert followup.conversation("FIRST", [], "now") == ([], "FIRST")
    assert followup.first_instruction([], "now") == "now"


def test_turns_become_alternating_pairs():
    turns = followup.parse_history([
        {"instruction": "ten classes", "answer": {"a": 1}},
        {"instruction": "darker", "answer": {"a": 2}, "note": "kept 1, 3"},
    ])
    assert followup.first_instruction(turns, "now") == "ten classes"
    history, user = followup.conversation("FIRST", turns, "shorter names")
    assert history[0] == ("FIRST", {"a": 1})
    assert "darker" in history[1][0] and history[1][1] == {"a": 2}
    assert "shorter names" in user and "kept 1, 3" in user
    assert "complete revised answer" in user


def test_an_empty_follow_up_asks_for_another_take():
    text = followup.follow_up_text("")
    assert "another take" in text


@pytest.mark.parametrize("raw", [
    "x",
    [1],
    [{"instruction": "a"}],
    [{"instruction": 3, "answer": {}}],
    [{"instruction": "a" * 3000, "answer": {}}],
    [{"instruction": "a", "answer": {"t": "x" * 70_000}}],
    [{"instruction": "a", "answer": {}}] * (followup.MAX_TURNS + 1),
])
def test_bad_history_is_refused(raw):
    with pytest.raises(followup.HistoryError):
        followup.parse_history(raw)


def test_note_is_clipped_and_non_strings_ignored():
    [t] = followup.parse_history([{"instruction": "a", "answer": {}, "note": "n" * 5000}])
    assert len(t["note"]) == followup.MAX_NOTE
    [t] = followup.parse_history([{"instruction": "a", "answer": {}, "note": 5}])
    assert t["note"] == ""
