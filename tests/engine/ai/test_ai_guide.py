"""engine/ai/guide.py — the authoring guide says only what the compilers accept."""
from __future__ import annotations

import json
import re

import pytest

from engine.ai import chat, guide, pack
from engine.ai import refs as ai_refs
from engine.ai import use as ai_use

COLORS = {"id": "abcd1234", "type": "wildcard", "name": "Colors",
          "payload": {"sub_categories": ["warm", "wet"],
                      "options": [{"id": "o1", "value": "red", "sub_categories": ["warm"]}]}}


def test_the_syntax_examples_compile_where_the_guide_says():
    refs = ai_refs.RefIndex([COLORS])
    for text, surface in [("{a|b|c}", "fixed"), ("{2$$, $$a|b|c}", "combine"),
                          ("{1-3$$ and $$a|b|c}", "option"),
                          ("@{Colors:warm and not wet}", "option"), ("@{Colors!null}", "action"),
                          ("$name.0 $name.neg $$5", "action"), ("$hair $eyes", "template")]:
        ai_refs.compile_text(text, surface=surface, refs=refs)
    for text, surface in [("$x", "option"), ("{a|b}", "template"), ("@{Colors}", "combine")]:
        with pytest.raises(ValueError):
            ai_refs.compile_text(text, surface=surface, refs=refs)


def test_every_use_clause_the_guide_names_parses():
    for clause in re.findall(r'"([a-z][^"]*)"', ai_use.GUIDE):
        if clause.startswith(("pick", "filter", "no empty", "match", "hold", "internal", "as")):
            inst, notes = ai_use.parse_use(clause, kind="wildcard", tags=["warm", "wet"])
            assert inst and not notes, clause


def test_the_guide_reaches_the_chat_and_the_planner():
    assert guide.SYNTAX in chat.SYSTEM_PROMPT and guide.CHAT in chat.SYSTEM_PROMPT
    assert guide.WHICH in pack.PLAN_SYSTEM and guide.COHERENCE in pack.PLAN_SYSTEM
    assert "run_test" not in pack.PLAN_SYSTEM


def test_the_worked_chat_example_runs_through_the_real_tools():
    lib = chat.Library([], [], [])
    proposals = []
    for step in guide.EXAMPLE_CHAT_STEPS:
        for call in step["calls"]:
            out = lib.run(call["tool"], chat.parse_args(json.dumps(call["args"])))
            if isinstance(out, dict):
                assert not [w for w in out["warnings"] if w.startswith("Left out")], out
                proposals.append(out)
            else:
                report = out
    season, outfit, rule = proposals
    payload = rule["op"]["body"]["payload"]
    # The constraint points at the ids the new wildcards will be created with,
    # and waits for them to be applied.
    assert payload["source_wildcard_id"] == season["op"]["body"]["id"]
    assert payload["target_wildcard_id"] == outfit["op"]["body"]["id"]
    assert rule["after"] == outfit["pid"]
    assert "Ran 100 seeds" in report and "sundress" in report
    assert "puffer jacket" in guide.EXAMPLES_CHAT
    assert guide.EXAMPLES_CHAT in chat.system_prompt()
    assert guide.COHERENCE not in chat.system_prompt(slim=True)
    assert len(chat.system_prompt(slim=True)) < len(chat.system_prompt()) * 0.8
