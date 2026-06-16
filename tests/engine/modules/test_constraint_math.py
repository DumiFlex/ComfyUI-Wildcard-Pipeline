from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor


def _pick(value, tags): return {"value": value, "tags": tags}
def _opt(value, tags): return {"value": value, "tags": tags}

def test_single_pick_single_tag_matrix():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0}}}
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"])], _opt("blue", ["somber"]), matrix, []) == 2.0

def test_multi_tag_option_multiplies_each_matching_cell():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0},
                        "tense":  {"mode": "reduce", "factor": 0.5}}}
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"])], _opt("x", ["somber", "tense"]), matrix, []) == 1.0

def test_multi_pick_multiplies_each_pick():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0}},
              "cold":  {"somber": {"mode": "boost", "factor": 3.0}}}
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"]), _pick("frost", ["cold"])],
        _opt("blue", ["somber"]), matrix, []) == 6.0

def test_exclude_is_absorbing():
    matrix = {"rainy": {"somber": {"mode": "exclude", "factor": 0.0}}}
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"])], _opt("blue", ["somber"]), matrix, []) is EXCLUDE

def test_exception_replaces_matrix_for_that_pair():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0}}}
    exc = [{"source_value": "rain", "target_value": "blue", "mode": "reduce", "factor": 0.25}]
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"])], _opt("blue", ["somber"]), matrix, exc) == 0.25

def test_untagged_option_no_matrix_contribution():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0}}}
    assert combine_constraint_factor(
        [_pick("rain", ["rainy"])], _opt("blue", []), matrix, []) == 1.0

def test_empty_picks_is_noop():
    matrix = {"rainy": {"somber": {"mode": "boost", "factor": 2.0}}}
    assert combine_constraint_factor([], _opt("blue", ["somber"]), matrix, []) == 1.0
