"""Feature cards (`engine/ai/cards.py`): which cards a message brings, the
caps, and when a card counts as already sent
(/pr-drafts/request-aware-prompts-plan.md, Phase 1)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.ai import cards as ai_cards

CORPUS = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "card-corpus.json")
                    .read_text(encoding="utf-8"))["rows"]


@pytest.mark.parametrize("row", CORPUS, ids=[r["text"][:40] for r in CORPUS])
def test_the_corpus(row):
    got = [c.key for c in ai_cards.pick(row["text"], kinds=set(row.get("kinds") or []),
                                        route=row.get("route"))]
    assert set(row["want"]) <= set(got), got
    assert not set(row.get("not") or []) & set(got), got


def test_every_card_is_short_and_reachable():
    keys = [c.key for c in ai_cards.CARDS]
    assert len(keys) == len(set(keys))
    for c in ai_cards.CARDS:
        assert len(c.text) <= 600, c.key  # ~150 tokens, like little-coder's cards
        assert c.words is not None or c.kinds, c.key
    wanted = {k for r in CORPUS for k in r["want"]}
    assert wanted == set(keys), set(keys) - wanted  # the corpus covers every card


def test_caps_and_order():
    text = ("if the class is warrior never give sandals, add negatives, make it rarer, "
            "use @{Colors:warm} and rename the variable")
    got = ai_cards.pick(text)
    assert len(got) == ai_cards.MAX_CARDS
    assert sum(len(c.text) for c in got) <= ai_cards.MAX_CHARS
    assert ai_cards.pick("") == []


def test_words_beat_kinds_and_the_page_breaks_ties():
    got = [c.key for c in ai_cards.pick("add a rule here", kinds={"derivation"})]
    assert got[0] == "derivation"
    tie = [c.key for c in ai_cards.pick("make it a bundle with a template")]
    on_page = [c.key for c in ai_cards.pick("make it a bundle with a template",
                                            route="/templates-edit/0123abcd")]
    assert set(tie) == set(on_page) == {"bundles", "template"}
    assert on_page[0] == "template"


def test_shown_cards_are_left_out():
    assert ai_cards.pick("never sandals in winter", shown={"constraint"}) == []
    assert ai_cards.for_tool("create_constraint").key == "constraint"
    assert ai_cards.for_tool("create_constraint", {"constraint"}) is None
    assert ai_cards.for_tool("read") is None


def test_sent_follows_what_the_model_can_still_read():
    meta: dict = {}
    ai_cards.mark(meta, [ai_cards.BY_KEY["refs"]], 2)
    ai_cards.mark(meta, [ai_cards.BY_KEY["constraint"]], 5, in_result=True)
    assert ai_cards.sent(meta, 9) == {"refs", "constraint"}
    assert ai_cards.sent(meta, 4) == {"refs"}  # a retry cut the entry off
    assert ai_cards.sent({**meta, "masked_before": 6}, 9) == {"refs"}  # results masked
    assert ai_cards.sent({**meta, "dropped_before": 3}, 9) == {"constraint"}  # summarised
    assert ai_cards.sent({"cards": {"refs": "bad"}}, 9) == set()
    ai_cards.mark(meta, [], 7)
    assert set(meta["cards"]) == {"refs", "constraint"}


def test_note_and_picked_ids():
    assert ai_cards.note([]) == ""
    n = ai_cards.note([ai_cards.BY_KEY["refs"]])
    assert n.startswith("(Notes for this ask:\n- Refs: @{Name}") and n.endswith(")")
    assert ai_cards.picked_ids("[[0123abcd#A]] and [[89abcdef]] [[0123abcd#A]]") == [
        "0123abcd", "89abcdef"]
