"""`scripts/ai_panel_evals.py`: every request reaches its panel route, and
each check passes on an answer that does what was asked (and fails on one
that doesn't), so a bad score means the model, not the script."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from engine.ai import config as ai_config
from engine.db.connection import resolve_db_path
from wp_api import _ai_client

_PATH = Path(__file__).resolve().parents[2] / "scripts" / "ai_panel_evals.py"


def _script():
    spec = importlib.util.spec_from_file_location("ai_panel_evals", _PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _opts(*texts, tags=(), negative=""):
    return {"axes": [], "options": [{"text": t, "weight": 1, "tags": list(tags),
                                     "negative": negative} for t in texts]}


def _act(var, value, mode="replace"):
    return {"target_var": var, "mode": mode, "value": value}


def _rule(var, op, value, actions, else_actions=(), extra=()):
    conds = [{"var": var, "op": op, "value": value}, *extra]
    return {"rules": [{"summary": "r", "branches": [{"match": "all", "conditions": conds,
                                                     "actions": actions}],
                       "else_actions": list(else_actions)}]}


#: An answer per request that does what it asks.
GOOD = {
    "add-3": _opts("green hair", "pink hair", "black hair"),
    "add-tagged": _opts("teal hair", "navy hair", "lavender hair", "ice white hair",
                        tags=["cool"]),
    "add-new": _opts("snow", "fog", "hail", "thunderstorm", "sleet", "mist", "sandstorm",
                     "rainbow after rain"),
    "add-negative": _opts("monsoon downpour", "rain at dusk", "stormy rain",
                          negative="sunshine, sunlight"),
    "add-many": _opts(*[f"style {n}" for n in range(20)]),
    "edit-retag": {"options": [{"id": n, "tags": ["long" if n in (3, 5) else "short"]}
                               for n in range(1, 7)]},
    "edit-remove": {"remove": [{"id": n, "reason": "short"} for n in (2, 4, 6)]},
    "edit-reweight": {"options": [{"id": 1, "weight": 2}, {"id": 2, "weight": 2}]},
    "edit-rewrite": {"options": [{"id": n, "text": f"tag_{n}"} for n in range(1, 5)]},
    "derive-else": _rule("eval_weather", "equals", "heavy rain", [_act("mood", "gloomy")],
                         [_act("mood", "cheerful")]),
    "derive-contains": _rule("eval_weather", "contains", "rain",
                             [_act("props", "umbrella", "append")]),
    "derive-and": _rule("eval_weather", "contains", "rain",
                        [_act("scene_note", "soaked dress")],
                        extra=[{"var": "eval_outfit", "op": "equals", "value": "sundress"}]),
    "text-fixed": {"values": [{"name": "room", "value": "bedroom", "negative": ""},
                              {"name": "light", "value": "warm lamp light", "negative": ""}]},
    "text-combine": {"template": "$eval_hair_color $eval_hair_style", "negative": ""},
    "text-template": {"template": "portrait, $eval_hair_color, $eval_hair_style, "
                                  "$eval_weather", "negative": ""},
    "constraint": {"rules": [{"source": "heavy rain", "target": "sundress",
                              "effect": "exclude", "factor": 0, "reason": "wet"}]},
    "describe": {"description": "Weather for outdoor scenes.", "tags": ["weather"]},
    "organize": {"items": [{"id": n, "category": "Hair" if n < 3 else "", "tags_add": [],
                            "tags_remove": [], "rating": "keep", "reason": "r"}
                           for n in (1, 2, 3)]},
}

#: An answer per request that misses what it asks.
BAD = {
    **{k: _opts("green hair") for k in ("add-3", "add-new", "add-many")},
    "add-tagged": _opts("teal hair", "navy hair", "lavender hair", "ice white hair"),
    "add-negative": _opts("monsoon downpour", "rain at dusk", "stormy rain"),
    "edit-retag": {"options": [{"id": 1, "tags": ["short"]}]},
    "edit-remove": {"remove": [{"id": 1, "reason": "x"}]},
    "edit-reweight": {"options": [{"id": 3, "weight": 2}]},
    "edit-rewrite": {"options": [{"id": 1, "text": "tag"}]},
    "derive-else": _rule("eval_weather", "equals", "heavy rain", [_act("mood", "gloomy")]),
    "derive-contains": _rule("eval_weather", "contains", "rain", [_act("props", "hat")]),
    "derive-and": _rule("eval_weather", "contains", "rain", [_act("scene_note", "wet")]),
    "text-fixed": {"values": [{"name": "room", "value": "bedroom", "negative": ""}]},
    "text-combine": {"template": "$eval_hair_color", "negative": ""},
    "text-template": {"template": "portrait, $eval_hair_color", "negative": ""},
    "constraint": {"rules": []},
    "describe": {"description": "", "tags": []},
    "organize": {"items": [{"id": 1, "category": "Hair", "tags_add": [], "tags_remove": [],
                            "rating": "keep", "reason": "r"}]},
}


@pytest.fixture
def evals(wp_client, monkeypatch):
    mod = _script()
    mod.seed_fixtures(resolve_db_path())
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": "http://127.0.0.1:1/v1", "model": "m1"})
    answer: dict = {}

    async def fake(cfg, path, body, kind, meter=None):
        return {"choices": [{"message": {"content": json.dumps(answer["v"])},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 20,
                          "completion_tokens_details": {"reasoning_tokens": 0}}}

    monkeypatch.setattr(_ai_client, "_answer", fake)
    mod.record_calls()
    return mod, answer


@pytest.mark.parametrize("name", list(GOOD))
async def test_each_check_passes_a_good_answer_and_fails_a_bad_one(evals, wp_client, name):
    mod, answer = evals
    rq = next(r for r in mod.REQUESTS if r["name"] == name)
    answer["v"] = GOOD[name]
    good = await mod.run_request(wp_client, rq)
    assert good["ok"] and good["passed"], good
    assert good["calls"] >= 1 and good["prompt"] >= 100 and good["thinking_off"]
    answer["v"] = BAD[name]
    bad = await mod.run_request(wp_client, rq)
    assert not bad.get("passed"), bad


def test_every_request_has_both_answers_and_the_report_adds_up():
    mod = _script()
    assert {r["name"] for r in mod.REQUESTS} == set(GOOD) == set(BAD)
    rows = [{"run": 1, "name": "add-3", "panel": "Add", "status": 200, "seconds": 2.0,
             "calls": 1, "prompt": 900, "output": 80, "thought": 0, "ok": True,
             "check": "", "passed": True, "dupes": 1},
            {"run": 1, "name": "describe", "panel": "Describe", "status": 502, "seconds": 4.0,
             "calls": 2, "prompt": 300, "output": 0, "thought": 50, "ok": False,
             "check": "bad answer"}]
    text = mod.report(rows, "m1", "note")
    assert "checks passed: 1 / 2" in text and "Model calls per request: 1.50" in text
    assert "| Describe | 0/1 |" in text
