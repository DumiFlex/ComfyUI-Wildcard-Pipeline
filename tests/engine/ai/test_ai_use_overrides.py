"""Use clauses for the per-use overrides the chat couldn't reach before:
option toggles, weights, pin, locked seed, derivation rules / branches off,
constraint rules off and reach (engine/ai/use.py)."""
from __future__ import annotations

import json
import re

import pytest

from engine.ai import use as ai_use
from engine.ai.chat_tools import _USE_KEYS
from engine.pipeline import PipelineEngine

HATS = {
    "var_binding": "hat",
    "sub_categories": ["warm", "wet"],
    "options": [
        {"id": "o1", "value": "beanie", "weight": 1, "sub_categories": ["warm"]},
        {"id": "o2", "value": "sun hat", "weight": 1},
        {"id": "o3", "value": "rain hood", "weight": 1, "sub_categories": ["wet"]},
        {"id": "o4", "value": "cap", "weight": 1},
    ],
}
RULES = {
    "rules": [
        {"id": "r1", "branches": [
            {"condition": {"var": "hat", "op": "exists"},
             "action": {"target_var": "a", "mode": "replace", "value": "one"}},
        ]},
        {"id": "r2", "branches": [
            {"condition": {"var": "hat", "op": "equals", "value": "nope"},
             "action": {"target_var": "b", "mode": "replace", "value": "if"}},
            {"condition": {"var": "hat", "op": "exists"},
             "action": {"target_var": "b", "mode": "replace", "value": "elif"}},
        ], "else": {"action": {"target_var": "b", "mode": "replace", "value": "else"}}},
    ],
}
CON = {
    "source_wildcard_id": "src00001",
    "target_wildcard_id": "tgt00001",
    "matrix": {"warm": {"wet": {"mode": "exclude", "factor": 0.0},
                        "dry": {"mode": "allow", "factor": 1.0}}},
    "exceptions": [{"source_value": "beanie", "target_value": "cap",
                    "mode": "exclude", "factor": 0.0}],
}


def _use(line, kind="wildcard", payload=HATS):
    return ai_use.parse_use(line, kind=kind, payload=payload)


# ── parse ───────────────────────────────────────────────────────────────

def test_option_toggles_by_number_text_and_id():
    inst, notes = _use('only options 1,"Rain  Hood",#o4')
    assert not notes and inst == {"enabled_options": ["o1", "o3", "o4"]}
    inst, notes = _use("off options 2,4")
    assert not notes and inst == {"enabled_options": ["o1", "o3"]}
    inst, notes = _use("only option 2")  # alias
    assert inst == {"enabled_options": ["o2"]} and not notes


def test_option_refs_refuse_rather_than_drop():
    for line, msg in [("only options 1,9", "no option 9 (it has 4)"),
                      ('only options "fedora"', "no option reads"),
                      ("only options #zz", "no option with id"),
                      ("off options 1,2,3,4", "every option off"),
                      ("only options 1,,2", "empty"),
                      ("only options 1.5", "isn't an option number")]:
        inst, notes = _use(line)
        assert inst == {} and len(notes) == 1 and msg in notes[0], (line, notes)


def test_option_numbers_need_the_payload_but_ids_dont():
    inst, notes = ai_use.parse_use("only options 1,2", kind="wildcard")
    assert inst == {} and "#id" in notes[0]
    inst, notes = ai_use.parse_use("only options #o1,#o2; pin #o2", kind="wildcard")
    assert not notes
    assert inst == {"enabled_options": ["o1", "o2"], "mode": "pinned", "pinned_option_id": "o2"}
    inst, notes = ai_use.parse_use("off options #o1", kind="wildcard")
    assert inst == {} and "only options" in notes[0]


def test_weights_pin_and_seed():
    inst, notes = _use('weight 3=2.5, "cap"=0; pin 2; seed 1234')
    assert not notes
    assert inst == {"option_weights": {"o3": 2.5, "o4": 0}, "mode": "pinned",
                    "pinned_option_id": "o2", "locked_seed": 1234}
    for line, msg in [("weight 3=-1", "between 0"), ("weight 3=lots", "isn't a number"),
                      ("weight 3=nan", "isn't a number"), ("weight 3", "option=weight"),
                      ("pin 1,2", "pin one option"), ("pin", "pin one option"),
                      ("seed -4", "whole number"), ("seed 1.5", "whole number"),
                      (f"seed {2**60}", "at most")]:
        inst, notes = _use(line)
        assert inst == {} and msg in notes[0], (line, notes)


def test_seed_reaches_other_kinds_and_old_spelling():
    for kind in ("combine", "fixed_values", "derivation"):
        assert ai_use.parse_use("seed locked to 7", kind=kind) == ({"locked_seed": 7}, [])
    inst, notes = ai_use.parse_use("seed 7", kind="constraint")
    assert inst == {} and "doesn't apply" in notes[0]


def test_derivation_rules_and_branches_off():
    inst, notes = _use("rules off 1; branches off 2.2, 2.else", kind="derivation",
                       payload=RULES)
    assert not notes
    assert inst == {"disabled_rule_ids": ["r1"], "disabled_branch_keys": ["r2:1", "r2:else"]}
    for line, msg in [("rules off 3", "no rule 3"), ("branches off 2.1", "branch 1 is the IF"),
                      ("branches off 2.3", "has 2 branches"), ("branches off 1.else", "no ELSE"),
                      ("branches off 2", "rule.branch"), ("rules off #nope", "no rule with id")]:
        inst, notes = _use(line, kind="derivation", payload=RULES)
        assert inst == {} and msg in notes[0], (line, notes)
    inst, notes = ai_use.parse_use("rules off #r9; branches off #r9.3", kind="derivation")
    assert not notes and inst == {"disabled_rule_ids": ["r9"], "disabled_branch_keys": ["r9:2"]}


def test_constraint_rules_off_and_reach():
    cell = json.dumps(["warm", "wet"], separators=(",", ":"))
    pair = json.dumps(["beanie", "cap"], separators=(",", ":"))
    inst, notes = _use("rules off 1,2; reach next 2", kind="constraint", payload=CON)
    assert not notes
    assert inst == {"disabled_matrix_cells": [cell], "disabled_exception_keys": [pair],
                    "target_select": {"mode": "next", "count": 2}}
    inst, notes = ai_use.parse_use('rules off warm->wet, "beanie">"cap"; reach first',
                                   kind="constraint")
    assert not notes
    assert inst == {"disabled_matrix_cells": [cell], "disabled_exception_keys": [pair],
                    "target_select": {"mode": "first"}}
    for line, msg in [("rules off 3", "no rule 3 (it has 2)"),
                      ("rules off warm>dry", "no tag cell"),
                      ('rules off "beanie">cap', "quote both sides"),
                      ("reach next 0", "between 1"), ("reach first 2", "reach first"),
                      ("reach picked", "editor")]:
        inst, notes = _use(line, kind="constraint", payload=CON)
        assert inst == {} and msg in notes[0], (line, notes)


# ── describe ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind,payload,line", [
    ("wildcard", HATS, "only options 1,3; weight 3=2.5, 4=0; pin 2; seed 1234"),
    ("derivation", RULES, "rules off 1; branches off 2.2, 2.else"),
    ("constraint", CON, "rules off 1,2; reach next 2"),
    ("constraint", CON, "reach all"),
])
def test_describe_round_trips(kind, payload, line):
    inst, notes = ai_use.parse_use(line, kind=kind, payload=payload)
    assert not notes
    assert ai_use.describe(inst, payload) == line
    # Without the payload it names things by id, which parse reads back.
    bare = ai_use.describe(inst)
    assert ai_use.parse_use(bare, kind=kind) == (inst, [])
    assert ai_use.parse_use(bare, kind=kind, payload=payload) == (inst, [])


def test_describe_shows_ids_without_the_payload():
    inst = {"enabled_options": ["o1"], "disabled_rule_ids": ["r2"], "locked_seed": 5,
            "target_select": {"mode": "pick", "picks": []}}
    assert ai_use.describe(inst) == \
        "only options #o1; seed 5; rules off #r2; reach picked targets (set in the editor)"


def test_bundle_edits_replace_the_new_keys():
    for key in ("enabled_options", "option_weights", "pinned_option_id", "locked_seed",
                "disabled_rule_ids", "disabled_branch_keys", "disabled_matrix_cells",
                "disabled_exception_keys"):
        assert key in _USE_KEYS
    # A picked reach can't be written back, so a use line never drops it.
    assert "target_select" not in _USE_KEYS


def test_every_new_clause_the_guide_names_parses():
    samples = {"wildcard": HATS, "derivation": RULES, "constraint": CON}
    words = ("only options", "off options", "weight", "pin", "seed", "rules off",
             "branches off", "reach")
    seen = set()
    for clause in re.findall(r'"([a-z][^"]*)"', ai_use.GUIDE):
        if not clause.startswith(words):
            continue
        ok = [k for k, p in samples.items()
              if ai_use.parse_use(clause, kind=k, payload=p)[0]
              and not ai_use.parse_use(clause, kind=k, payload=p)[1]]
        assert ok, clause
        seen.add(next(w for w in words if clause.startswith(w)))
    assert seen == set(words)


# ── the engine honours what parse writes ───────────────────────────────

def _wild(inst, uid="w1", mid="abcd0001", payload=HATS):
    return {"type": "wildcard", "id": mid, "_uid": uid, "payload": payload,
            "instance": {"variable_binding": payload["var_binding"], **inst}}


def _hats(line, seeds=range(30)):
    inst, notes = _use(line)
    assert not notes
    return {PipelineEngine().run([_wild(inst)], seed=s)["hat"] for s in seeds}


def test_engine_option_toggles_weights_and_pin():
    assert _hats("only options 1,3") == {"beanie", "rain hood"}
    assert _hats("off options 1,2,3") == {"cap"}
    assert _hats("weight 1=0, 2=0, 4=0") == {"rain hood"}
    assert _hats("pin 2") == {"sun hat"}


def test_engine_locked_seed_ignores_the_run_seed():
    assert len(_hats("seed 99")) == 1
    assert len(_hats("")) > 1


def test_engine_derivation_rules_and_branches_off():
    def run(line):
        inst, notes = _use(line, kind="derivation", payload=RULES)
        assert not notes
        return PipelineEngine().run([
            _wild({"mode": "pinned", "pinned_option_id": "o1"}),
            {"type": "derivation", "id": "dddd0001", "payload": RULES, "instance": inst},
        ], seed=1)
    out = run("")
    assert out.get("a") == "one" and out.get("b") == "elif"
    out = run("rules off 1; branches off 2.2")
    assert "a" not in out and out.get("b") == "else"
    out = run("branches off 2.2, 2.else")
    assert "b" not in out


def test_engine_constraint_rules_off():
    src = {"var_binding": "top", "sub_categories": ["warm"],
           "options": [{"id": "s1", "value": "beanie", "weight": 1, "sub_categories": ["warm"]}]}
    tgt = {"var_binding": "shoe", "sub_categories": ["wet", "dry"],
           "options": [{"id": "t1", "value": "boots", "weight": 1, "sub_categories": ["wet"]},
                       {"id": "t2", "value": "cap", "weight": 1, "sub_categories": ["dry"]}]}

    def shoes(line):
        inst, notes = _use(line, kind="constraint", payload=CON)
        assert not notes
        got = set()
        for s in range(30):
            out = PipelineEngine().run([
                _wild({}, uid="u1", mid="src00001", payload=src),
                {"type": "constraint", "id": "cccc0001", "payload": CON, "instance": inst},
                _wild({}, uid="u2", mid="tgt00001", payload=tgt),
            ], seed=s)
            got.add(out["shoe"])
        return got
    # Cell warm→wet drops boots; the beanie→cap pair drops cap: nothing live.
    assert shoes("") <= {"", "boots", "cap"} and "boots" not in shoes("") \
        and "cap" not in shoes("")
    assert shoes("rules off 1") == {"boots"}
    assert shoes("rules off 2") == {"cap"}
    assert shoes("rules off 1,2") == {"boots", "cap"}


def test_engine_constraint_reach_first_stops_after_one_target():
    src = {"var_binding": "top", "sub_categories": ["warm"],
           "options": [{"id": "s1", "value": "beanie", "weight": 1, "sub_categories": ["warm"]}]}
    tgt = {"var_binding": "shoe", "sub_categories": ["wet", "dry"],
           "options": [{"id": "t1", "value": "boots", "weight": 1, "sub_categories": ["wet"]},
                       {"id": "t2", "value": "flats", "weight": 1, "sub_categories": ["dry"]}]}
    con = {**CON, "exceptions": []}
    inst, notes = _use("reach first", kind="constraint", payload=con)
    assert not notes
    second = set()
    for s in range(30):
        out = PipelineEngine().run([
            _wild({}, uid="u1", mid="src00001", payload=src),
            {"type": "constraint", "id": "cccc0001", "payload": con, "instance": inst},
            _wild({}, uid="u2", mid="tgt00001", payload=tgt),
            _wild({"variable_binding": "shoe2"}, uid="u3", mid="tgt00001", payload=tgt),
        ], seed=s)
        assert out["shoe"] == "flats"
        second.add(out["shoe2"])
    assert "boots" in second  # the second target is out of reach
