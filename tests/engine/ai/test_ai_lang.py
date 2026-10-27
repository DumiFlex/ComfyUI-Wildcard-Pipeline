"""Requests in any language: the English gate and the request frame."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.ai import lang, request_check
from engine.ai import wildcard_edit as edit

CORPUS = json.loads((Path(__file__).parents[2] / "fixtures" /
                     "request-language-corpus.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize(("text", "english"), CORPUS)
def test_the_gate_reads_the_corpus(text, english):
    assert lang.looks_english(text) is english


def test_the_setting_decides_when_it_isnt_automatic():
    assert lang.needs_frame("Mach Regen seltener")
    assert not lang.needs_frame("make rain rarer")
    assert not lang.needs_frame("Mach Regen seltener", "english")
    assert lang.needs_frame("make rain rarer", "other")
    assert not lang.needs_frame("", "other")
    assert not lang.needs_frame("(retry)", "other")


def _raw(**over):
    return {"language": "de", "english": "Make rain rarer", "kind": "change", "count": None,
            "weight": "rarer", "factor": None, "wants": [], **over}


def test_a_frame_is_checked_field_by_field():
    f = lang.compile_frame(_raw(), "Mach Regen seltener")
    assert f == {"language": "de", "english": "Make rain rarer", "kind": "change",
                 "count": None, "weight": "rarer", "factor": None, "wants": [],
                 "text": "Mach Regen seltener"}
    # A wrong field is dropped, not guessed.
    f = lang.compile_frame(_raw(kind="order", count=0, weight="a lot", factor=True,
                                wants=["negatives", "x", "negatives"]), "t")
    assert (f["kind"], f["count"], f["weight"], f["factor"], f["wants"]) == (
        None, None, "none", None, ["negatives"])
    assert lang.compile_frame(_raw(count=400), "t")["count"] is None
    assert lang.compile_frame(_raw(count=True), "t")["count"] is None
    # The factor decides the way: "half as likely" is rarer.
    f = lang.compile_frame(_raw(weight="commoner", factor=0.5), "t")
    assert (f["weight"], f["factor"]) == ("rarer", 0.5)
    assert lang.compile_frame(_raw(factor=1), "t")["factor"] is None
    # No restatement, no frame.
    assert lang.compile_frame(_raw(english=" "), "t") is None
    assert lang.compile_frame({"options": []}, "t") is None
    assert lang.compile_frame("Make rain rarer", "t") is None


def test_the_frame_answers_the_checks():
    f = lang.compile_frame(_raw(count=6, wants=["negatives"]), "t")
    assert lang.check_text(f, "t") == "Make rain rarer"
    assert lang.check_text(None, "t") == "t"
    assert lang.count(f) == 6 and lang.count(None) == 0
    assert lang.weight_direction(f) == -1 and lang.weight_direction(None) == 0
    assert lang.wants(f) == ["negatives"] and lang.wants(None) is None
    assert lang.message_kind(f) == "task"
    assert lang.message_kind(lang.compile_frame(_raw(kind="question"), "t")) == "question"
    chat = lang.compile_frame(_raw(kind="chat"), "t")
    assert lang.message_kind(chat) == "chat"
    # A chat that already proposed cards: small talk carries on the work.
    assert lang.message_kind(chat, working=True) == "task"
    assert lang.message_kind(None) is None


def test_checks_compare_content_in_its_own_language():
    raw, english = "Wetter für Wüstenstädte", "weather for desert towns"
    plan = {"slots": [{"name": "Weather", "options": ["sandstorm at noon", "clear sky"]}]}
    assert lang.for_content(raw, english, plan) == english
    plan = {"slots": [{"name": "Wetter", "options": ["Sandsturm am Mittag", "klarer Himmel"]}]}
    assert lang.for_content(raw, english, plan) == raw
    assert lang.for_content("rain", "rain", "Regen") == "rain"


def test_the_request_check_reads_the_frames_wants():
    card = [{"tool": "create_wildcard", "op": {"body": {"payload": {"options": [
        {"value": "sword"}]}}}}]
    german = "Erstelle eine Waffen-Wildcard mit Negativen"
    assert request_check.gaps(german, card) == []
    assert request_check.gaps(german, card, wants=["negatives"]) == ["negatives"]
    assert request_check.gaps(german, card, wants=[]) == []
    # An "only" rule counts as the constraint too.
    assert request_check.gaps(german, card, wants=["constraint", "only_rule"]) == [
        'an "only" rule (effect only: the target may use just what the row names)']


def test_a_reweight_in_another_language_is_held_to_its_way():
    rows = [{"id": "1", "value": "rain", "weight": 1.0, "sub_categories": []}]
    up = {"options": [{"id": "1", "weight": 3}]}
    frame = lang.compile_frame(_raw(), "Mach Regen seltener")
    out = edit.compile_edit("reweight", up, options=rows, registry=[],
                            instruction="Mach Regen seltener", frame=frame)
    assert not out["changes"]
    out = edit.compile_edit("reweight", up, options=rows, registry=[],
                            instruction="Mach Regen seltener")
    assert out["changes"]


def test_no_word_counts_for_both_sides():
    assert not lang._OTHER & lang._ENGLISH
