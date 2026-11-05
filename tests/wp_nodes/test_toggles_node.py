"""Node-level tests for WP_Toggles."""
import json
from types import SimpleNamespace

from engine import negatives
from wp_nodes.toggles_node import WPToggles
from wp_nodes.types import ContextPayload

CFG = {"version": 1, "mode": "any", "group_var": "", "rows": [
    {"id": "aaaa0000", "kind": "label", "name": "LoRAs", "color": 1},
    {"id": "00000001", "kind": "toggle", "name": "LoRA character", "var": "use_lora_character",
     "on": False, "pin": True, "out": 1, "style": "switch"},
    {"id": "00000002", "kind": "toggle", "name": "Use its own clothes", "var": "use_own_clothes",
     "on": True, "pin": True, "out": 2, "style": "checkbox", "needs": "00000001"},
    {"id": "00000003", "kind": "toggle", "name": "Anime look", "var": "anime_look",
     "on": True, "pin": False, "style": "chip"},
]}


def _run(config=CFG, node_id="7", **kwargs):
    WPToggles.hidden = SimpleNamespace(unique_id=node_id)
    try:
        return WPToggles.execute(wp_toggles=json.dumps(config), **kwargs)
    finally:
        del WPToggles.hidden


def test_schema():
    s = WPToggles.define_schema()
    assert s.node_id == "WP_Toggles"
    assert s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == ["upstream", "wp_toggles"]
    assert [o.name for o in s.outputs] == ["context"] + [f"toggle_{i}" for i in range(1, 17)]
    assert s.not_idempotent is True


def test_writes_internal_vars_and_booleans():
    out = _run()
    payload, *bools = out.values
    assert len(bools) == 16
    assert bools[:2] == [False, False]  # child of an off parent is off
    assert not any(bools[2:])
    assert payload.context == {
        "use_lora_character": "false", "use_own_clothes": "false", "anime_look": "true",
    }
    assert payload.internals["__wp_internal_flags__"] == {
        "use_lora_character": True, "use_own_clothes": True, "anime_look": True,
    }
    trace = payload.debug["__wp_trace__"]
    assert [t["binding"] for t in trace] == ["use_lora_character", "use_own_clothes", "anime_look"]
    assert all(t["node"] == "WP_Toggles" and t["internal"] and t["node_id"] == "7" for t in trace)
    assert "__wp_warnings__" not in payload.debug


def test_extends_upstream_and_clears_negatives():
    up = ContextPayload(
        context={"subject": "cat", "anime_look": "old"},
        debug={"__wp_trace__": [{"node": "x"}]},
        internals={negatives.NEG_KEY: {"anime_look": ["bad"], "subject": ["blurry"]},
                   "__wp_internal_flags__": {"subject": False}},
    )
    payload = _run(upstream=up).values[0]
    assert payload.context["subject"] == "cat"
    assert payload.context["anime_look"] == "true"
    assert payload.internals[negatives.NEG_KEY] == {"subject": ["blurry"]}
    assert payload.internals["__wp_internal_flags__"]["subject"] is False
    assert payload.debug["__wp_trace__"][0] == {"node": "x"}
    assert up.context["anime_look"] == "old"  # upstream untouched


def test_pick_one_group_var():
    cfg = {"mode": "one", "group_var": "framing", "rows": [
        {"id": "1", "kind": "toggle", "name": "Portrait", "var": "portrait",
         "on": False, "pin": True, "out": 1},
        {"id": "2", "kind": "toggle", "name": "Full body", "var": "full_body",
         "on": True, "pin": True, "out": 2},
    ]}
    payload, *bools = _run(config=cfg).values
    assert payload.context["framing"] == "Full body"
    assert bools[:2] == [False, True]
    types = {t["binding"]: t["type"] for t in payload.debug["__wp_trace__"]}
    assert types["framing"] == "pick"


def test_problems_become_warnings():
    cfg = {"rows": [
        {"id": "1", "kind": "toggle", "name": "A", "var": "x", "on": True},
        {"id": "2", "kind": "toggle", "name": "B", "var": "x", "on": True},
    ]}
    warns = _run(config=cfg).values[0].debug["__wp_warnings__"]
    assert warns[0]["type"] == "toggles_problem"
    assert warns[0]["node_id"] == "7"


def test_empty_widget():
    WPToggles.hidden = SimpleNamespace(unique_id=None)
    try:
        payload, *bools = WPToggles.execute().values
    finally:
        del WPToggles.hidden
    assert payload.context == {}
    assert bools == [False] * 16


def test_upstream_sets_an_opted_in_switch_before_needs():
    cfg = json.loads(json.dumps(CFG))
    cfg["rows"][1]["upstream"] = True
    cfg["rows"][3]["upstream"] = True
    up = ContextPayload(
        context={"use_lora_character": "Yes", "anime_look": "maybe"}, debug={}, internals={},
    )
    payload, *bools = _run(cfg, upstream=up).values
    assert bools[:2] == [True, True]  # parent set by upstream, child follows
    assert payload.context["anime_look"] == "true"  # not a yes/no word: switch kept
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert trace["use_lora_character"]["source"] == "upstream"
    assert "source" not in trace["anime_look"]


PICK = {"version": 1, "mode": "one", "group_var": "look", "rows": [
    {"id": "00000001", "kind": "toggle", "name": "Day", "var": "day", "on": True,
     "upstream": True, "value": "bright $time light"},
    {"id": "00000002", "kind": "toggle", "name": "Night", "var": "night", "on": False,
     "upstream": True},
    {"id": "00000003", "kind": "toggle", "name": "Dusk", "var": "dusk", "on": False,
     "upstream": True},
]}


def test_pick_value_resolves_vars_and_stays_internal_by_default():
    up = ContextPayload(context={"time": "noon"}, debug={}, internals={})
    payload, *_ = _run(PICK, upstream=up).values
    assert payload.context["look"] == "bright noon light"
    assert payload.internals["__wp_internal_flags__"]["look"] is True


def test_pick_shown_in_prompt():
    cfg = {**PICK, "group_visible": True}
    payload, *_ = _run(cfg).values
    assert "look" not in payload.internals["__wp_internal_flags__"]
    assert payload.internals["__wp_internal_flags__"]["day"] is True


def test_upstream_trues_beat_the_canvas_pick_and_warn_when_several():
    up = ContextPayload(context={"night": "yes", "dusk": "on"}, debug={}, internals={})
    payload, *_ = _run(PICK, upstream=up).values
    assert payload.context["look"] == "Night"
    warns = [w for w in payload.debug["__wp_warnings__"] if w["type"] == "toggles_upstream_many"]
    assert warns and "Night" in warns[0]["message"]


def test_upstream_group_var_names_the_pick():
    cfg = {**PICK, "group_upstream": True}
    up = ContextPayload(context={"look": "dusk", "night": "yes"}, debug={}, internals={})
    payload, *_ = _run(cfg, upstream=up).values
    assert payload.context["look"] == "Dusk"
    assert payload.context["dusk"] == "true" and payload.context["night"] == "false"
