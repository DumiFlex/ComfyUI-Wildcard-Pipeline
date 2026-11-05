"""Counts and weight factors read from a typed request."""
import json
from pathlib import Path

import pytest

from engine.ai.asked import option_count, weight_direction, weight_factor

CORPUS = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "asked-count-corpus.json").read_text("utf-8"))


@pytest.mark.parametrize("text,count", CORPUS["cases"],
                         ids=[c[0] or "empty" for c in CORPUS["cases"]])
def test_option_count_corpus(text: str, count: int) -> None:
    assert option_count(text) == count


@pytest.mark.parametrize("text,factor", [
    ("make formal and evening wear half as likely", 0.5),
    ("halve the weights of the formal ones", 0.5),
    ("twice as common", 2.0),
    ("double the casual ones", 2.0),
    ("3 times more likely", 3.0),
    ("3 times less likely", round(1 / 3, 4)),
    ("a quarter as likely", 0.25),
    ("make the rain rarer", None),
    ("set everything to 1", None),
])
def test_weight_factor(text: str, factor: float | None) -> None:
    assert weight_factor(text) == factor


@pytest.mark.parametrize("text,way", [
    ("make formal and evening wear half as likely", -1),
    ("make the rain rarer", -1),
    ("less common", -1),
    ("make heterochromia rare", -1),
    ("make sunny more common", 1),
    ("twice as likely", 1),
    ("make rain rarer and sun more common", 0),
    ("set everything to 1", 0),
])
def test_weight_direction(text: str, way: int) -> None:
    assert weight_direction(text) == way


def test_draft_options_reads_the_count_from_the_request():
    from engine.ai import client_tools

    class Lib:
        def get(self, raw):
            return {"id": "w1", "type": "wildcard", "name": "Weather"} if raw == "Weather" else None

        def _kind(self, row):
            return "wildcard"

    args, label = client_tools.prepare(Lib(), "draft_options",
                                       {"id": "Weather", "instruction": "desert weather"},
                                       "Open Weather and draft 6 desert weather options")
    assert args["count"] == 6 and label == "Drafting 6 options for Weather"
    args, _ = client_tools.prepare(Lib(), "draft_options",
                                   {"id": "Weather", "instruction": "rainy weather"})
    assert args["count"] == 10
    args, _ = client_tools.prepare(Lib(), "draft_options",
                                   {"id": "Weather", "instruction": "8 rainy options", "count": 4})
    assert args["count"] == 4
