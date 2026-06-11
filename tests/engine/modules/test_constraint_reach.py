"""SP3 reach selector — `apply_constraints_for_target` applies EVERY
constraint whose `target_select` covers a firing target instance
(no more one-shot / consumed-set). A per-constraint hit counter
(`__wp_constraint_hits__`) drives first/next/all/pick coverage.
"""
from __future__ import annotations

from engine.modules._constraints import apply_constraints_for_target


def _src():
    return {"picks": [{"value": "rain", "tags": ["rainy"]}]}


def _c(cid, mode, count=None, factor=2.0):
    ts = {"mode": mode} if count is None else {"mode": mode, "count": count}
    return {
        "target_wildcard_id": "T",
        "source_wildcard_id": "S",
        "__constraint_module_id__": cid,
        "target_select": ts,
        "matrix": {"rainy": {"somber": {"mode": "boost", "factor": factor}}},
        "exceptions": [],
    }


def _o():
    return [{"value": "blue", "sub_categories": ["somber"], "weight": 1.0}]


def test_all_applies_every_instance():
    hits = {}
    picks = {"S": _src()}
    c = [_c("c1", "all")]
    for _ in range(3):
        out, applied = apply_constraints_for_target(
            _o(), "T", c, picks, [], hits=hits, firing_uid="u"
        )
        assert applied and out[0]["weight"] == 2.0


def test_first_applies_only_first():
    hits = {}
    picks = {"S": _src()}
    c = [_c("c1", "first")]
    w = [
        apply_constraints_for_target(
            _o(), "T", c, picks, [], hits=hits, firing_uid="u"
        )[0][0]["weight"]
        for _ in range(3)
    ]
    assert w == [2.0, 1.0, 1.0]


def test_next_n_applies_first_n():
    hits = {}
    picks = {"S": _src()}
    c = [_c("c1", "next", count=2)]
    w = [
        apply_constraints_for_target(
            _o(), "T", c, picks, [], hits=hits, firing_uid="u"
        )[0][0]["weight"]
        for _ in range(3)
    ]
    assert w == [2.0, 2.0, 1.0]


def test_two_constraints_stack_on_one_instance():
    hits = {}
    picks = {"S": _src()}
    c = [_c("c1", "all", factor=2.0), _c("c2", "all", factor=3.0)]
    out, applied = apply_constraints_for_target(
        _o(), "T", c, picks, [], hits=hits, firing_uid="u"
    )
    assert applied and out[0]["weight"] == 6.0


def test_pick_nested_occurrence_matches_carrier_option():
    from engine.modules._constraints import apply_constraints_for_target
    picks = {"S": {"picks": [{"value": "rain", "tags": ["rainy"]}]}}
    c = [{
        "target_wildcard_id": "T",
        "source_wildcard_id": "S",
        "__constraint_module_id__": "c1",
        "target_select": {
            "mode": "pick",
            "picks": [{"kind": "nested", "carrier_uid": "carrUID", "option_id": "optA"}],
        },
        "matrix": {"rainy": {"somber": {"mode": "boost", "factor": 2.0}}},
        "exceptions": [],
    }]
    opts = [{"value": "blue", "sub_categories": ["somber"], "weight": 1.0}]
    # Wrong carrier_uid → nested pick misses → weight untouched.
    out, _ = apply_constraints_for_target(
        opts, "T", c, picks, [], hits={},
        carrier_ctx={"carrier_uid": "other", "option_id": "optA"},
    )
    assert out[0]["weight"] == 1.0
    # Matching (carrier_uid, option_id) → nested pick covers → boost ×2.
    opts2 = [{"value": "blue", "sub_categories": ["somber"], "weight": 1.0}]
    out, _ = apply_constraints_for_target(
        opts2, "T", c, picks, [], hits={},
        carrier_ctx={"carrier_uid": "carrUID", "option_id": "optA"},
    )
    assert out[0]["weight"] == 2.0
