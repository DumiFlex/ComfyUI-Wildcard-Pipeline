"""engine/ai/pack/drafts.py — best of N plan drafts, picked by code."""
from __future__ import annotations

import asyncio
import copy

import pytest

from engine.ai import pack
from engine.ai.pack import drafts

from .test_ai_pack_graph import GRAPH

REQUEST = "fantasy heroes; elves never use guns; mages get a title"


def _plan(**over):
    g = copy.deepcopy(GRAPH)
    g.update(over)
    return pack.compile_graph_plan(g, request=REQUEST)


def test_a_plan_without_the_asked_rule_scores_lower():
    full = drafts.score_plan(_plan(), REQUEST)
    bare = drafts.score_plan(_plan(relations=[]), REQUEST)
    assert bare["score"] < full["score"]
    assert any("states a rule" in r for r in bare["reasons"])


def test_bad_refs_and_missing_request_words_cost_points():
    plan = _plan()
    clean = drafts.score_plan({**plan, "bad_refs": []}, REQUEST)
    bad = drafts.score_plan({**plan, "bad_refs": ["exclude: x", "only: y"]}, REQUEST)
    assert clean["score"] - bad["score"] == 2 * drafts.BAD_REF
    gaps = drafts.score_plan(plan, REQUEST + "; dragons and pirate ships")
    assert gaps["score"] < clean["score"]
    assert any("dragons" in r for r in gaps["reasons"])


def test_pick_draft_keeps_the_best_and_the_first_on_a_tie():
    good, bare = _plan(), _plan(relations=[])
    best, scores = drafts.pick_draft([bare, good, good], REQUEST)
    assert best == 1 and len(scores) == 3
    best, _ = drafts.pick_draft([good, good], REQUEST)
    assert best == 0
    line = drafts.draft_line(1, scores)
    assert line.startswith("Kept draft 2 of 3")
    assert drafts.draft_line(0, scores[:1]) == ""
    with pytest.raises(ValueError):
        drafts.pick_draft([], REQUEST)


def test_run_pack_with_three_drafts_keeps_the_best_one():
    answers = [{**copy.deepcopy(GRAPH), "relations": []}, copy.deepcopy(GRAPH),
               {**copy.deepcopy(GRAPH), "relations": []}]
    temps: list[float] = []

    async def complete(**kw):
        if kw.get("schema_name") == "pack_graph":
            temps.append(kw["temperature"])
            return answers.pop(0) if answers else copy.deepcopy(GRAPH)
        if kw.get("schema_name") == "pack_refs":
            return {"relations": []}
        raise ValueError("no item builds in this test")

    out = asyncio.run(pack.run_pack(complete, REQUEST, seeds=5, repairs=0,
                                    settings={"drafts": "three"}))
    assert temps[:3] == list(drafts.DRAFT_TEMPERATURES)
    assert any("Kept draft 2 of 3" in line for line in out["log"])
    assert out["plan"]["graph"]["relations"]


def test_drafts_setting_defaults_to_one():
    assert pack.parse_settings({})["drafts"] == "one"
    assert pack.parse_settings({"drafts": "three"})["drafts"] == "three"
    assert pack.parse_settings({"drafts": "nine"})["drafts"] == "one"
