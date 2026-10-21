"""Worked examples for small models: built-in ones and applied cards."""
from __future__ import annotations

from engine.ai import examples
from engine.ai.tools import catalog, registry


def test_every_built_in_example_is_a_valid_call():
    for row in examples.BUILTIN:
        for call in row["calls"]:
            _args, notes = registry.check_args(catalog.BY_NAME[call["tool"]], call["args"])
            assert notes == [], (row["ask"], notes)


def test_applied_examples_are_kept_newest_first_short_and_once(tmp_path):
    where = tmp_path / "ai-examples.json"
    long = {"id": "Weapon", "options": [{"text": "x" * 300}] * 9}
    assert examples.add("add axes to Weapon", [{"tool": "add_options", "args": long}], where)
    assert examples.add("make a Hat wildcard", [{"tool": "create_wildcard", "args": {
        "name": "Hat"}}], where)
    assert examples.add("add axes to Weapon", [{"tool": "add_options", "args": {
        "id": "Weapon", "options": [{"text": "war axe"}]}}], where)
    rows = examples.load(where)
    assert [r["ask"] for r in rows] == ["add axes to Weapon", "make a Hat wildcard"]
    assert rows[0]["calls"][0]["args"]["options"] == [{"text": "war axe"}]
    assert not examples.add("", [{"tool": "read", "args": {}}], where)
    assert not examples.add("hello", [], where)
    cut = examples.compact(long)
    assert len(cut["options"]) == examples.LIST_ITEMS
    assert len(cut["options"][0]["text"]) == examples.TEXT_CHARS


def test_the_most_alike_examples_are_picked_the_users_own_first():
    own = [{"ask": "add a crossbow to my Weapon list", "calls": [
        {"tool": "add_options", "args": {"id": "Weapon"}}]}]
    got = examples.pick("add a halberd to my Weapon", own)
    assert got[0] is own[0]
    assert any("war axe" in r["ask"] for r in got)
    assert examples.pick("hello", own) == []
    text = examples.note(got)
    assert text.startswith("Requests like this one")
    assert '"add a crossbow to my Weapon list" → add_options {"id": "Weapon"}' in text
    assert examples.note([]) == ""
