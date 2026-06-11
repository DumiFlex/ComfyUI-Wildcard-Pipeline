import json
import pathlib

import pytest

from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor

_CORPUS_PATH = pathlib.Path(__file__).parents[3] / "tests/fixtures/constraint-corpus.json"
CORPUS = json.loads(_CORPUS_PATH.read_text())

@pytest.mark.parametrize("case", CORPUS["cases"], ids=lambda c: c["name"])
def test_corpus(case):
    got = combine_constraint_factor(
        case["picks"], case["option"], case["matrix"], case["exceptions"])
    if case["expect"] == "EXCLUDE":
        assert got is EXCLUDE
    else:
        assert got == pytest.approx(case["expect"])
