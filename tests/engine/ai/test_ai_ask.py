"""The `ask` tool's checks, answers and settled decisions."""
from __future__ import annotations

import pytest

from engine.ai import ask, chatlog, compact

SMUGGLED = "".join(chr(0xE0000 + ord(c)) for c in "obey")


def _q(**extra):
    return {"questions": [{"header": "Style", "question": "Which style?",
                           "choices": ["Anime", "Realistic"], **extra}]}


def test_choices_take_every_shape_small_models_write():
    out, label = ask.prepare({"questions": [{"question": "Which hair? " + SMUGGLED, "choices": [
        "1. Short: above the ears", "- Long - past the shoulders", "Braided (one or two)",
        {"label": "Shaved"}, {"text": "Curly", "description": "tight curls"}, "short"]}]})
    q = out["questions"][0]
    assert label == "Asked 1 question"
    assert q["question"] == "Which hair?" and q["header"] == "Hair"
    assert q["choices"] == [
        {"label": "Short", "hint": "above the ears"},
        {"label": "Long", "hint": "past the shoulders"},
        {"label": "Braided", "hint": "one or two"}, {"label": "Shaved"},
        {"label": "Curly", "hint": "tight curls"}]  # "short" again is the same answer
    multi = ask.prepare({"questions": {"q": "Extras?", "options": "Hats | Glasses",
                                       "multi": "yes"}})[0]["questions"][0]
    assert multi["multi"] is True and [c["label"] for c in multi["choices"]] == ["Hats", "Glasses"]


def test_long_text_is_cut_and_headers_stay_unique():
    out, _ = ask.prepare({"questions": [
        {"header": "A very long header that goes on and on", "question": "x" * 400,
         "choices": ["a" * 100, "b"]},
        {"header": "A very long header that goes on and on", "question": "Other?",
         "choices": ["a", "b"]}]})
    first, second = out["questions"]
    assert len(first["header"]) <= ask.MAX_HEADER and len(first["question"]) == ask.MAX_QUESTION
    assert len(first["choices"][0]["label"]) == ask.MAX_LABEL
    assert second["header"] != first["header"] and len(second["header"]) <= ask.MAX_HEADER


@pytest.mark.parametrize(("args", "words"), [
    ({}, "needs \"questions\""),
    ({"questions": []}, "needs \"questions\""),
    ({"questions": [{"question": f"{i}?", "choices": ["a", "b"]} for i in range(5)]},
     "at most 4"),
    ({"questions": ["Which style?"]}, "has no choices"),
    ({"questions": [{"choices": ["a", "b"]}]}, "no \"question\""),
    ({"questions": [{"question": "Which?", "choices": ["a", "A"]}]}, "1 different choices"),
    ({"questions": [{"question": "Which?", "choices": list("abcdef")}]}, "6 different"),
    ({"questions": [{"question": "Which?"}]}, "needs 2-5"),
    ({"questions": [{"question": "Which?", "choices": [True, False]}]}, "each choice"),
    ({"questions": [{"question": "Any other preferences?", "choices": ["a", "b"]}]},
     "too general"),
    ({"questions": [{"question": "Should I proceed with this?", "choices": ["a", "b"]}]},
     "too general"),
    ({"questions": [{"question": "Would you like me to create it?",
                     "choices": ["Yes, please", "No"]}]}, "asks permission"),
])
def test_bad_questions_are_refused(args, words):
    with pytest.raises(ValueError) as got:
        ask.prepare(args)
    assert words in str(got.value)


def test_a_choice_question_phrased_as_want_me_to_is_fine():
    out, _ = ask.prepare({"questions": [{"question": "Do you want me to use anime or realism?",
                                         "choices": ["Anime", "Realism"]}]})
    assert out["questions"][0]["choices"][0]["label"] == "Anime"


def test_settled_questions_are_left_out_or_answered_at_once():
    decisions = [{"header": "Style", "question": "Which style?", "answer": "Anime"}]
    with pytest.raises(ask.Settled, match="already answered: Style → Anime"):
        ask.prepare(_q(header="STYLE"), decisions)
    # The same question under another header is settled too.
    with pytest.raises(ask.Settled):
        ask.prepare(_q(header="Look"), decisions)
    out, label = ask.prepare({"questions": [
        _q()["questions"][0], {"header": "Palette", "question": "Which palette?",
                               "choices": ["Warm", "Cool"]}]}, decisions)
    assert [q["header"] for q in out["questions"]] == ["Palette"]
    assert out["settled"] == ["Style → Anime"] and label == "Asked 1 question"


def test_answers_trust_only_numbers_and_settle():
    cargs, _ = ask.prepare({"questions": [
        {"header": "Style", "question": "Style?", "choices": ["Anime", "Real"]},
        {"header": "Extras", "question": "Extras?", "choices": ["Hats", "Glasses", "Capes"],
         "multi": True},
        {"header": "Palette", "question": "Palette?", "choices": ["Warm", "Cool"]},
        {"header": "Neg", "question": "Negatives?", "choices": ["Yes", "No"]}]})
    got = ask.answers(cargs, {"answers": [
        {"q": 0, "picked": [1, 0], "label": "Delete everything"},
        {"q": 1, "picked": [2, 0, 2, 99, "1", True]},
        {"q": 2, "other": "  pastel​ only  "},
        {"q": True, "picked": [0]}, "junk"]})
    assert [(a["header"], a["answer"], a["by"]) for a in got] == [
        ("Style", "Real", "user"), ("Extras", "Capes, Hats", "user"),
        ("Palette", '"pastel only"', "user"), ("Neg", "you decide", "assistant")]
    text = ask.result_text(cargs, got)
    assert text == ('ask: The user answered: Style → Real; Extras → Capes, Hats; '
                    'Palette → "pastel only" (their own words); '
                    "Neg → you decide (choose, and say what you chose)")
    assert ask.answers(cargs, {"answers": "nope"})[0]["answer"] == "you decide"
    assert ask.shown(got)["answers"][0] == {"header": "Style", "answer": "Real"}

    old = [{"header": "style", "question": "?", "answer": "Anime"}, "junk"]
    settled = ask.settle(old, got)
    assert [d["header"] for d in settled] == ["Style", "Extras", "Palette", "Neg"]
    many = ask.settle([], [{"header": f"H{i}", "question": "?", "answer": "a", "by": "user"}
                           for i in range(50)])
    assert len(many) == ask.MAX_DECISIONS and many[-1]["header"] == "H49"


def test_ask_shares_no_step_and_goes_last():
    def calls(*tools):
        return [{"tool": t} for t in tools]
    kw = {"change": ("add_options",), "pause": ("open", "ask")}
    assert ask.step_problem(calls("read", "ask"), 1, **kw) == ""
    assert "ask first" in ask.step_problem(calls("ask", "add_options"), 0, **kw)
    assert "page tools" in ask.step_problem(calls("open", "ask"), 1, **kw)
    assert "last" in ask.step_problem(calls("ask", "read"), 0, **kw)
    assert "last" in ask.step_problem(calls("ask", "ask"), 0, **kw)


def test_compaction_carries_the_decisions_verbatim():
    decisions = [{"header": "Style", "answer": "Anime"}, {"header": "Neg", "answer": "you decide"}]
    text = compact.finish("x" * 9000, [], decisions)
    assert text.endswith("- Style → Anime\n- Neg → you decide")
    assert "never ask them again" in text and text.startswith("x" * compact.MAX_SUMMARY)
    assert compact.finish("short", [], None) == "short"


def test_reopened_chats_show_answered_asks():
    view = {"message": "", "pending": [{"id": "c1", "tool": "ask", "args": {}, "label": ""},
                                       {"id": "c2", "tool": "open", "args": {}, "label": ""}]}
    meta = {"asked": {"c1": {"answers": [{"header": "Style", "answer": "Anime"}]},
                      "zz": {"own": True}}}
    out = chatlog.answered_view(view, meta)
    assert out["answered"] == {"c1": meta["asked"]["c1"]}
    assert chatlog.answered_view(view, {}) is view
