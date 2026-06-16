import json
import pathlib

import pytest

from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor
from engine.modules.derivation_handler import branch_carrier_key

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


# Py≡TS branch-key parity: the carrier key the engine stamps for a derivation
# branch occurrence MUST be byte-identical to the key TS computes
# (constraint-pairs.ts `branchKey`). The shared corpus is the single source of
# truth so the two formats cannot drift independently.
@pytest.mark.parametrize("case", CORPUS["branch_key_cases"], ids=lambda c: c["name"])
def test_branch_key_corpus(case):
    assert branch_carrier_key(case["rule_id"], case["branch"]) == case["key"]
