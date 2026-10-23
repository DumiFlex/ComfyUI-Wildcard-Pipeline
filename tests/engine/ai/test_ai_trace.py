"""Answer traces (`engine/ai/trace.py`), the trace report script and the chat
eval's smoke set (/pr-drafts/request-aware-prompts-plan.md, Phase 0)."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

from engine.ai import chat as ai_chat
from engine.ai import trace as ai_trace

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def _script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_nudges_are_named_by_the_constant_they_came_from():
    assert ai_trace.nudge_label(ai_chat.EMPTY_NUDGE) == "empty_nudge"
    assert ai_trace.nudge_label(ai_chat.EMPTY_WORDS_NUDGE) == "empty_words_nudge"
    assert ai_trace.nudge_label(ai_chat.CHECK_NUDGE + " and more") == "check_nudge"
    assert ai_trace.nudge_label("something new") == "other"
    assert ai_trace.nudge_label(None) == "other"


def test_tail_kinds_keep_only_what_was_sent_in_order():
    got = ai_trace.tail_kinds({"recipe": "(Steps…)", "library": "hits", "model": "",
                               "since": "", "plan": None})
    assert got == ["library", "recipe"]


def test_step_and_turn_records():
    st = ai_trace.step_record(1, ["read", "search"], [{"tool": "read"}],
                              {"prompt": 9000, "cached": 8800, "output": 40, "cut": False})
    assert st == {"n": 1, "called": ["read"], "offered": ["read", "search"], "prompt": 9000,
                  "cached": 8800, "output": 40}
    assert "offered" not in ai_trace.step_record(2, None, [], {})
    tr = ai_trace.turn_record(steps=[st], tail=["library"], short=["read"],
                              notes=[ai_chat.EMPTY_NUDGE], refused={}, errors={"read": 1},
                              widened=False, plan_n=0, model="qwen3.5-9b", profile="small")
    assert tr["notes"] == ["empty_nudge"] and tr["short"] == ["read"]
    assert "refused" not in tr and "widened" not in tr and "plan_n" not in tr


def test_a_mostly_uncached_later_step_is_a_reread():
    steps = [{"prompt": 9000, "cached": 0}, {"prompt": 9500, "cached": 9000},
             {"prompt": 9800, "cached": 1000}, {"prompt": 900, "cached": 0}]
    assert ai_trace.rereads({"steps": steps}) == 1  # the first and the tiny one don't count


def test_summarize_counts_misses_docs_and_nudges():
    traces = [
        {"steps": [{"called": ["more_tools"], "prompt": 100, "cached": 0},
                   {"called": ["create_wildcard"]}], "short": ["read"], "widened": True,
         "notes": ["empty_nudge"], "tail": ["library"], "refused": {"read: not found": 2}},
        {"steps": [{"called": ["explain"]}], "tail": ["library", "recipe"]},
        "not a trace",
    ]
    total = ai_trace.summarize(traces)
    assert total["answers"] == 2 and total["steps"] == 3
    assert total["more_tools"] == 1 and total["docs"] == 1 and total["widened"] == 1
    assert total["shortlisted"] == 1
    assert total["notes"] == {"empty_nudge": 1}
    assert total["tail"] == {"library": 2, "recipe": 1}
    assert total["refused"] == {"read: not found": 2}


def test_the_report_script_reads_traces_from_a_library(tmp_path):
    db = tmp_path / "library.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE ai_chats (id TEXT, updated_at TEXT)")
    conn.execute("CREATE TABLE ai_chat_messages (chat_id TEXT, seq INTEGER, body TEXT)")
    conn.execute("INSERT INTO ai_chats VALUES ('c1', '2026-10-23T00:00:00Z')")
    trace = {"steps": [{"called": ["more_tools"]}], "model": "qwen3.5-9b"}
    for seq, body in enumerate([{"kind": "user", "text": "hi"},
                                {"kind": "shown", "view": {}, "trace": trace},
                                {"kind": "shown", "view": {}}]):
        conn.execute("INSERT INTO ai_chat_messages VALUES ('c1', ?, ?)", (seq, json.dumps(body)))
    conn.commit()
    conn.close()
    report = _script("ai_trace_report")
    assert report.load_traces(db) == [trace]
    assert report.load_traces(db, model="other") == []
    assert report.load_traces(db, since="2026-11-01") == []
    text = report.render(ai_trace.summarize(report.load_traces(db)))
    assert "more_tools calls: 1" in text and "| more_tools | 1 |" in text


def test_the_smoke_set_checks_card_content():
    evals = _script("ai_chat_evals")
    assert len(evals.SMOKE) == 10 and evals.SETS["smoke"] is evals.SMOKE
    for sc in evals.SMOKE:
        assert len(sc["check"]) == len(sc["turns"]) == len(sc["expect"]), sc["name"]
    refs = next(s for s in evals.SMOKE if s["name"] == "s-refs")["check"][1]
    good = {"proposals": [{"op": {"body": {"payload": {"options": [
        {"value": "@{Colors} jacket"}]}}}}]}
    assert refs(good) and not refs({"proposals": []})
    out = {"proposals": [{"tool": "create_wildcard", "op": {}}], "steps": [],
           "message": ""}
    scored = evals.score_turn(out, ["create_wildcard"], lambda o: False)
    assert scored["content"] is False and scored["did"] is True
    assert evals.score_turn(out, None, lambda o: 1 / 0)["content"] is False
    assert evals.score_turn(out, None)["content"] is None
