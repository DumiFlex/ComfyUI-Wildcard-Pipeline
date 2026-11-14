"""Explain mode — the per-module detail the WP Debug node shows.

A run opts in with ``ctx["__wp_explain__"] = True`` (the canvas Context node
does). Each trace row then carries the module's display name and a ``detail``
dict from its handler, and warnings raised while a module ran name it as
their owner. Without the flag the trace is unchanged.
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine


def _wildcard(uid, binding, values, name="", **instance):
    return {
        "type": "wildcard", "id": uid, "_uid": uid, "name": name,
        "payload": {
            "var_binding": binding,
            "options": [
                {"id": v, "value": v, "weight": w, "sub_categories": []}
                for v, w in values
            ],
        },
        "instance": {"variable_binding": binding, **instance},
    }


def _t(var, op="equals", value=""):
    return {"var": var, "op": op, "value": value}


def _derivation(rules, uid="der00001", instance=None):
    return {
        "type": "derivation", "id": uid, "_uid": uid, "meta": {"name": "Lighting"},
        "payload": {"rules": rules}, "instance": instance or {},
    }


def _explain_run(modules, seed=0, **ctx_vars):
    ctx = {"__wp_explain__": True, **ctx_vars}
    return PipelineEngine().run(modules, ctx=ctx, seed=seed)


def _row(ctx, uid):
    return next(r for r in ctx["__wp_trace__"] if r.get("_uid") == uid)


def test_trace_is_unchanged_without_the_flag():
    ctx = PipelineEngine().run([_wildcard("w1", "mood", [("calm", 1)], name="Mood")], seed=1)
    row = _row(ctx, "w1")
    assert "detail" not in row and "name" not in row
    assert "__wp_module_detail__" not in ctx


def test_trace_rows_carry_name_and_detail():
    ctx = _explain_run([_wildcard("w1", "mood", [("calm", 1), ("tense", 3)], name="Mood")])
    row = _row(ctx, "w1")
    assert row["name"] == "Mood"
    d = row["detail"]
    assert d["option_id"] == ctx["mood"]
    assert d["pool"] == 2 and d["live"] == 2
    assert d["chance"] == (0.25 if ctx["mood"] == "calm" else 0.75)
    assert "__wp_module_detail__" not in ctx


def test_name_falls_back_to_library_meta():
    ctx = _explain_run([_derivation([])])
    assert _row(ctx, "der00001")["name"] == "Lighting"


def test_multi_pick_lists_every_option():
    w = _wildcard("w1", "props", [("a", 1), ("b", 1), ("c", 1)], pick_min=2, pick_max=2)
    d = _row(_explain_run([w]), "w1")["detail"]
    assert len(d["option_ids"]) == 2 and d["range"] == [2, 2]


def test_derivation_reports_the_fired_branch_and_each_test():
    rule = {
        "id": "r1",
        "branches": [
            {"condition": _t("time", value="day"),
             "action": {"target_var": "light", "mode": "replace", "value": "sun"}},
            {"condition": {"match": "all", "conditions": [
                _t("time", value="night"),
                {"match": "any", "conditions": [_t("sky", value="rain"), _t("sky", value="fog")]},
            ]},
             "action": {"target_var": "light", "mode": "replace", "value": "lamps"}},
            {"condition": _t("time", op="exists"),
             "action": {"target_var": "light", "mode": "replace", "value": "never"}},
        ],
        "else": {"action": {"target_var": "light", "mode": "replace", "value": "dim"}},
    }
    ctx = _explain_run([_derivation([rule])], time="night", sky="fog")
    assert ctx["light"] == "lamps"
    (rd,) = _row(ctx, "der00001")["detail"]["rules"]
    assert rd["fired"] == 1 and rd["has_else"] is True
    # Branches after the one that fired are never evaluated.
    assert [b["index"] for b in rd["branches"]] == [0, 1]
    assert rd["branches"][0]["matched"] is False
    assert rd["branches"][0]["condition"] == {
        "var": "time", "op": "equals", "value": "day", "actual": "night", "result": False,
    }
    group = rd["branches"][1]["condition"]
    assert group["match"] == "all" and group["result"] is True
    inner = group["conditions"][1]
    assert inner["match"] == "any"
    # Every member of a group is evaluated, even past the first match.
    assert [c["result"] for c in inner["conditions"]] == [False, True]
    assert rd["action"] == {
        "target": "light", "mode": "replace", "value": "lamps", "result": "lamps",
    }


def _set(var, value):
    return {"target_var": var, "mode": "replace", "value": value}


def test_derivation_else_disabled_and_unset_reads():
    rules = [
        {"id": "r1", "branches": [{"condition": _t("missing", value="x"),
                                   "action": {"target_var": "a", "mode": "replace", "value": "1"}}],
         "else": {"action": {"target_var": "a", "mode": "replace", "value": "fallback"}}},
        {"id": "r2", "branches": [{"condition": _t("a", value="fallback"),
                                   "action": _set("b", "2")}]},
        {"id": "r3", "branches": [{"condition": _t("a", op="exists"),
                                   "action": _set("c", "3")}]},
    ]
    ctx = _explain_run([_derivation(rules, instance={"disabled_rule_ids": ["r3"]})])
    r1, r2, r3 = _row(ctx, "der00001")["detail"]["rules"]
    assert r1["fired"] == "else" and r1["branches"][0]["condition"]["actual"] is None
    # r2 sees r1's write — the explanation is taken when the rule runs.
    assert r2["fired"] == 0 and r2["branches"][0]["condition"]["actual"] == "fallback"
    assert r3["disabled"] is True and r3["fired"] is None


def test_constraint_detail_and_pick_attribution():
    con = {
        "type": "constraint", "id": "con00001", "_uid": "con00001",
        "payload": {
            "source_wildcard_id": "src00001", "target_wildcard_id": "tgt00001",
            "matrix": {},
            "exceptions": [{"source_value": "maid", "target_value": "apron",
                            "mode": "only", "factor": 1.0}],
            "target_select": {"mode": "first"},
        },
        "instance": {},
    }
    ctx = _explain_run([
        _wildcard("src00001", "role", [("maid", 1)]),
        con,
        _wildcard("tgt00001", "outfit", [("apron", 1), ("jacket", 1)]),
    ])
    cd = _row(ctx, "con00001")["detail"]
    assert cd == {"uid": "con00001", "reach": {"mode": "first"}, "cells": 0,
                  "exceptions": 1, "only": True}
    td = _row(ctx, "tgt00001")["detail"]
    assert td["live"] == 1 and td["chance"] == 1.0
    assert td["constraints"] == [{"id": "con00001", "uid": "con00001", "name": "",
                                  "source": "src00001", "source_value": "maid"}]


def test_warnings_name_the_module_that_raised_them():
    w = _wildcard("w1", "look", [("@{deadbeef#hat} on", 1)], name="Look")
    ctx = _explain_run([w])
    (warn,) = [x for x in ctx["__wp_warnings__"] if x["type"] == "unknown_ref"]
    assert warn["owner_uid"] == "w1" and warn["owner_id"] == "w1"
    assert warn["detail"]["name"] == "hat"


# ── Options table, pool steps, seeds (WP Debug "why did it never pick X") ──


def test_wildcard_lists_every_option_and_why_it_is_out():
    w = _wildcard(
        "w1", "mood", [("calm", 1), ("tense", 3), ("angry", 2), ("sad", 0)], name="Mood",
        enabled_options=["calm", "tense", "sad"], option_weights={"tense": 5},
        locked_seed=7,
    )
    w["payload"]["options"][0]["sub_categories"] = ["soft"]
    w["payload"]["options"][1]["sub_categories"] = ["soft"]
    w["payload"]["options"][3]["sub_categories"] = ["soft"]
    w["instance"]["category_filter"] = "soft"
    d = _row(_explain_run([w]), "w1")["detail"]
    rows = {r["id"]: r for r in d["options"]}
    assert rows["angry"]["cut"] == "filter" and rows["angry"]["weight"] is None
    assert "cut" not in rows["calm"] and rows["calm"]["weight"] == 1
    tense = rows["tense"]
    assert tense["base"] == 3 and tense["override"] == 5 and tense["weight"] == 5
    assert rows["sad"]["cut"] == "weight"
    assert d["steps"] == {"library": 4, "filter": 3, "toggles": 3, "live": 2}
    assert d["locked_seed"] is True


def test_toggled_off_option_is_marked_toggle():
    w = _wildcard("w1", "mood", [("calm", 1), ("tense", 1)], enabled_options=["calm"])
    d = _row(_explain_run([w]), "w1")["detail"]
    assert {r["id"]: r.get("cut") for r in d["options"]} == {"calm": None, "tense": "toggle"}
    assert d["steps"]["toggles"] == 1


def test_options_table_is_capped():
    from engine.modules.wildcard_handler import OPTIONS_SHOWN
    w = _wildcard("w1", "n", [(f"o{i}", 1) for i in range(OPTIONS_SHOWN + 5)])
    d = _row(_explain_run([w]), "w1")["detail"]
    assert len(d["options"]) == OPTIONS_SHOWN and d["options_more"] == 5


def test_multi_pick_reports_its_separator():
    w = _wildcard(
        "w1", "outfit", [("a", 1), ("b", 1), ("c", 1)],
        pick_min=2, pick_max=2, pick_separator=" + ",
    )
    d = _row(_explain_run([w]), "w1")["detail"]
    assert d["separator"] == " + " and d["range"] == [2, 2]


def test_match_variable_reports_the_value_it_read():
    w = _wildcard("w1", "style", [("pony", 1), ("sdxl", 1)], match_variable="model_variant")
    d = _row(_explain_run([w], model_variant="pony"), "w1")["detail"]
    assert d["match_variable"] == "model_variant" and d["match_value"] == "pony"


def test_fixed_values_report_source_rows_and_toggled_off():
    fv = {
        "type": "fixed_values", "id": "f1", "_uid": "f1",
        "payload": {"values": [
            {"id": "a", "name": "quality", "value": "{best|best} quality"},
            {"id": "b", "name": "steps", "value": "28"},
        ]},
        "instance": {"enabled_options": ["a"]},
    }
    d = _row(_explain_run([fv]), "f1")["detail"]
    assert d["source"] == "library" and d["toggled_off"] == ["steps"]
    assert d["rows"] == [{"name": "quality", "raw": "{best|best} quality"}]


def test_combine_reports_template_and_reads():
    cb = {
        "type": "combine", "id": "c1", "_uid": "c1",
        "payload": {"template": "$mood $missing light", "output_var": "scene", "input_vars": []},
        "instance": {},
    }
    d = _row(_explain_run([cb], mood="calm"), "c1")["detail"]
    assert d["template"] == "$mood $missing light" and d["template_source"] == "library"
    assert d["reads"] == {"mood": "calm", "missing": None}
