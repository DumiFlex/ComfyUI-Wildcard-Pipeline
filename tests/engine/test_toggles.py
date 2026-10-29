"""engine/toggles.py — resolution, outputs and problems."""
import json
from pathlib import Path

import pytest

from engine import toggles

CORPUS = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "toggles-corpus.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", CORPUS, ids=[c["name"] for c in CORPUS])
def test_corpus(case):
    cfg = toggles.parse_config(json.dumps(case["config"]))
    assert toggles.resolve(cfg) == case["values"]
    n = len(case["outputs"])
    vals = toggles.output_values(cfg)
    assert len(vals) == toggles.MAX_OUTPUTS
    assert vals[:n] == case["outputs"]
    assert not any(vals[n:])


@pytest.mark.parametrize(
    "raw", ["", "{", "[]", "null", 5, {"rows": "x"}, {"rows": [1, {"kind": "toggle"}]}],
)
def test_broken_config_is_empty(raw):
    cfg = toggles.parse_config(raw)
    assert cfg.toggles == []
    assert toggles.resolve(cfg) == {}
    assert toggles.output_values(cfg) == [False] * 16


def test_parse_reads_dict_and_defaults():
    cfg = toggles.parse_config({"mode": "bogus", "rows": [
        {"id": "a1", "kind": "toggle", "on": 1, "pin": True, "out": True, "var": " x "},
    ]})
    assert cfg.mode == "any"
    t = cfg.toggles[0]
    assert (t.name, t.var, t.on, t.pin, t.out) == ("a1", "x", False, True, 0)


def test_more_than_sixteen_pins_are_cut():
    rows = [
        {"id": f"{i:08x}", "kind": "toggle", "var": f"v{i}", "on": True, "pin": True, "out": i + 1}
        for i in range(20)
    ]
    cfg = toggles.parse_config({"rows": rows})
    assert len(toggles.output_slots(cfg)) == 16
    assert toggles.output_values(cfg) == [True] * 16


def test_problems():
    cfg = toggles.parse_config({"mode": "any", "group_var": "", "rows": [
        {"id": "1", "name": "A", "var": "x", "needs": "2"},
        {"id": "2", "name": "B", "var": "x", "needs": "1"},
        {"id": "3", "name": "C", "var": "bad-name"},
    ]})
    msgs = toggles.problems(cfg)
    assert any("both write $x" in m for m in msgs)
    assert any("bad-name" in m for m in msgs)
    assert sum("loop" in m for m in msgs) == 2


def test_problems_group_var_and_pick_one_ignores_loops():
    cfg = toggles.parse_config({"mode": "one", "group_var": "1x", "rows": [
        {"id": "1", "var": "a", "needs": "1"},
    ]})
    msgs = toggles.problems(cfg)
    assert msgs == ["The Pick one variable can't be used: 1x"]
