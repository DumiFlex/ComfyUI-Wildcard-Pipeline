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
    slow = ai_trace.step_record(3, None, [], {"output": 300, "thought": 290}, 12.345)
    assert slow["thought"] == 290 and slow["seconds"] == 12.3
    stuck = ai_trace.timed_out_record(4, ["read"], 240.0)
    assert stuck == {"n": 4, "called": [], "offered": ["read"], "seconds": 240.0,
                     "timed_out": True}
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
    timed = ai_trace.summarize([{"steps": [
        {"called": [], "seconds": 5.0, "thought": 40},
        {"called": [], "seconds": 240.0, "timed_out": True}]}])
    assert timed["timed_out"] == 1 and timed["thought_tokens"] == 40
    assert timed["seconds"] == 245.0 and timed["slowest"] == 240.0


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


def test_each_eval_run_gets_a_fresh_library(tmp_path):
    evals = _script("ai_chat_evals")
    (tmp_path / "library.db").write_text("clean")
    restore = evals.fresh_copy(tmp_path)
    (tmp_path / "library.db").write_text("edited by run 1")
    (tmp_path / "library.db-wal").write_text("wal")
    (tmp_path / "ai-examples.json").write_text("{}")
    (tmp_path / "wildcard-pipeline.ai-index.db").write_text("index")
    from wp_api import _ai_context

    class Open:
        closed = False

        def close(self):
            Open.closed = True

    _ai_context._INDEXES["x"] = Open()  # type: ignore[assignment]
    restore()
    assert Open.closed and not _ai_context._INDEXES
    assert (tmp_path / "library.db").read_text() == "clean"
    assert not (tmp_path / "library.db-wal").exists()
    assert not (tmp_path / "ai-examples.json").exists()
    assert not (tmp_path / "wildcard-pipeline.ai-index.db").exists()


def test_summarize_counts_questions_and_the_first_offer():
    rec = ai_trace.turn_record(steps=[ai_trace.step_record(1, ["search", "read"], [], {})], tail=[],
                            short=None, notes=[], refused={}, errors={}, widened=False,
                            plan_n=0, model="m", profile="small", asks="question")
    assert rec["asks"] == "question"
    task = ai_trace.turn_record(steps=[ai_trace.step_record(
        1, ["search", "read", "create_wildcard"], [{"tool": "create_wildcard"}], {})], tail=[],
        short=None, notes=[], refused={}, errors={}, widened=False, plan_n=0, model="m",
        profile="small")
    assert "asks" not in task
    total = ai_trace.summarize([rec, task])
    assert total["questions"] == 1 and total["question_changes"] == 0
    assert total["first_offered"] == 3


def test_the_smoke_checks_read_compiled_refs():
    evals = _script("ai_chat_evals")
    checks = {s["name"]: s["check"][1] for s in evals.SMOKE
              if s["name"] in ("s-refs", "s-tag-filter")}

    def card(text):
        return {"proposals": [{"op": {"body": {"payload": {"options": [{"value": text}]}}}}]}

    assert checks["s-refs"](card("a @{0a1b2c3d#Colors} jacket"))
    assert checks["s-tag-filter"](card("a @{0a1b2c3d#Palette:warm} sky"))
    assert not checks["s-tag-filter"](card("a @{0a1b2c3d#Palette} sky"))


def test_each_run_keeps_its_library_for_the_trace_report(tmp_path):
    evals = _script("ai_chat_evals")
    (tmp_path / "library.db").write_text("clean")
    restore = evals.fresh_copy(tmp_path)
    restore()  # before the first run: nothing to keep
    (tmp_path / "library.db").write_text("run 1")
    restore()
    (tmp_path / "library.db").write_text("run 2")
    restore()
    runs = sorted((tmp_path / "runs").iterdir())
    assert [p.read_text() for p in runs] == ["run 1", "run 2"]
    assert (tmp_path / "library.db").read_text() == "clean"
