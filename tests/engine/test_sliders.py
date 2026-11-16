"""engine/sliders.py — resolution, numbers, outputs and problems."""
import json
from pathlib import Path

import pytest

from engine import sliders

CORPUS = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "sliders-corpus.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", CORPUS, ids=[c["name"] for c in CORPUS])
def test_corpus(case):
    cfg = sliders.parse_config(json.dumps(case["config"]))
    assert sliders.resolve(cfg) == case["values"]
    assert sliders.nums(cfg) == case["nums"]
    assert sliders.own_negatives(cfg) == case.get("negatives", {})
    n = len(case["outputs"])
    vals = sliders.output_values(cfg)
    assert len(vals) == sliders.MAX_OUTPUTS
    assert vals[:n] == case["outputs"]
    assert not any(vals[n:])
    assert sorted(sliders.internal_vars(cfg)) == case.get("internal", [])


@pytest.mark.parametrize(
    "raw", ["", "{", "[]", "null", 5, {"rows": "x"}, {"rows": [1, {"kind": "slider"}]}],
)
def test_broken_config_is_empty(raw):
    cfg = sliders.parse_config(raw)
    assert cfg.sliders == []
    assert sliders.resolve(cfg) == {}
    assert sliders.output_values(cfg) == [0] * 16


def test_parse_defaults_and_junk():
    cfg = sliders.parse_config({"rows": [
        {"id": "x", "var": "a", "value": "nope", "min": True, "max": float("nan"),
         "step": -1, "decimals": 99, "mode": "loud", "words": [1, {"word": "w", "upto": False}]},
        {"id": "y", "kind": "label", "name": "L"},
    ]})
    (s,) = cfg.sliders
    assert (s.value, s.min, s.max, s.step, s.decimals, s.mode) == (0.0, 0.0, 1.0, 0.01, 6, "number")
    assert [(w.word, w.upto) for w in s.words] == [("w", None)]
    assert s.name == "x"


def test_int_output_type():
    cfg = sliders.parse_config({"rows": [
        {"id": "a", "var": "steps", "value": 27.6, "decimals": 0, "pin": True, "out": 1},
    ]})
    (v, *_rest) = sliders.output_values(cfg)
    assert v == 28 and isinstance(v, int)


def test_problems():
    cfg = sliders.parse_config({"rows": [
        {"id": "a", "name": "A", "var": "x", "min": 1, "max": 1},
        {"id": "b", "name": "B", "var": "x"},
        {"id": "c", "name": "C", "var": "1x"},
    ]})
    msgs = sliders.problems(cfg)
    assert any("max that is not above its min" in m for m in msgs)
    assert any("both write $x" in m for m in msgs)
    assert any("can't be used: 1x" in m for m in msgs)


def test_lookup_num():
    assert sliders.lookup_num({"a": "0.5"}, "word", "a") == "0.5"
    assert sliders.lookup_num(None, " 7 ", "a") == "7"
    assert sliders.lookup_num(None, "nan", "a") is None
    assert sliders.lookup_num(None, "seven", "a") is None
    assert sliders.lookup_num({"a": ""}, None, "a") is None
