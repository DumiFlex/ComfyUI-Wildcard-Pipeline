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


def test_visible_toggle_shows_in_the_assembler():
    rows = [dict(r) for r in CFG["rows"]]
    rows[3]["visible"] = True  # Anime look: the globe turned off
    up = ContextPayload(
        context={}, debug={}, internals={"__wp_internal_flags__": {"anime_look": True}},
    )
    payload, *_ = _run({**CFG, "rows": rows}, upstream=up).values
    flags = payload.internals["__wp_internal_flags__"]
    assert "anime_look" not in flags
    assert flags["use_lora_character"] is True
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert trace["anime_look"]["internal"] is False


def _pick_value(value: str) -> dict:
    rows = [dict(r) for r in PICK["rows"]]
    rows[0]["value"] = value
    return {**PICK, "rows": rows}


def test_pick_value_keeps_inline_picks_as_written():
    up = ContextPayload(context={"time": "noon"}, debug={"node_seed": 5}, internals={})
    payload, *_ = _run(_pick_value("{golden|soft} $time light"), upstream=up).values
    assert payload.context["look"] == "{golden|soft} noon light"


def test_plain_pick_name_is_kept():
    payload, *_ = _run({**PICK, "rows": [{**PICK["rows"][1], "on": True}]}).values
    assert payload.context["look"] == "Night"


def test_pick_value_missing_variable_warns():
    payload, *_ = _run(_pick_value("$nowhere light")).values
    warns = payload.debug["__wp_warnings__"]
    assert any(w["type"] == "unknown_var" and "$nowhere" in w["message"] for w in warns)
    assert all(w["node_id"] == "7" for w in warns)


def test_pick_one_files_the_picked_negative():
    up = ContextPayload(
        context={"shade": "dark"},
        debug={},
        internals={negatives.NEG_KEY: {"time": [{"text": "old", "pick": None, "source": "x"}]}},
    )
    cfg = {"mode": "one", "group_var": "time", "rows": [
        {"id": "1", "kind": "toggle", "name": "Day", "var": "day", "on": False,
         "negative": "night sky"},
        {"id": "2", "kind": "toggle", "name": "Night", "var": "night", "on": True,
         "negative": " $shade sun "},
    ]}
    payload = _run(config=cfg, upstream=up).values[0]
    assert payload.internals[negatives.NEG_KEY]["time"] == [
        {"text": "dark sun", "pick": None, "source": "WP_Toggles"},
    ]


def test_pick_one_without_negative_clears_old_one():
    up = ContextPayload(
        context={}, debug={},
        internals={negatives.NEG_KEY: {"time": [{"text": "old", "pick": None, "source": "x"}]}},
    )
    cfg = {"mode": "one", "group_var": "time", "rows": [
        {"id": "1", "kind": "toggle", "name": "Day", "var": "day", "on": True},
    ]}
    payload = _run(config=cfg, upstream=up).values[0]
    assert "time" not in payload.internals[negatives.NEG_KEY]


def test_any_on_value_bool_and_negative():
    up = ContextPayload(
        context={"weather": "storm"}, debug={},
        internals={negatives.NEG_KEY: {"fog": [{"text": "old", "pick": None, "source": "x"}]}},
    )
    cfg = {"mode": "any", "rows": [
        {"id": "1", "kind": "toggle", "name": "Rain", "var": "rain", "on": True,
         "value": "heavy $weather rain", "negative": "sunny"},
        {"id": "2", "kind": "toggle", "name": "Fog", "var": "fog", "on": False,
         "value": "thick fog", "negative": "clear air"},
        {"id": "3", "kind": "toggle", "name": "Wind", "var": "wind", "on": True},
    ]}
    payload = _run(config=cfg, upstream=up).values[0]
    assert payload.context["rain"] == "heavy storm rain"
    assert payload.context["fog"] == ""
    assert payload.context["wind"] == "true"
    assert payload.internals["__wp_toggle_bools__"] == {"rain": True, "fog": False, "wind": True}
    neg = payload.internals[negatives.NEG_KEY]
    assert neg["rain"] == [{"text": "sunny", "pick": None, "source": "WP_Toggles"}]
    assert "fog" not in neg  # off: the old negative is cleared, its own not filed
    rows = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert rows["rain"]["bool"] is True and rows["rain"]["has_value"] is True
    assert rows["rain"]["negative"] == "sunny"
    assert rows["wind"]["bool"] is True and "has_value" not in rows["wind"]


def test_bool_accessor_reads_across_nodes_in_the_assembler():
    from engine import template
    from engine.context import strip_internals, with_resolver_tables

    cfg = {"mode": "any", "rows": [
        {"id": "1", "kind": "toggle", "name": "Rain", "var": "rain", "on": True,
         "value": "heavy rain", "visible": True},
        {"id": "2", "kind": "toggle", "name": "Wind", "var": "wind", "on": False},
    ]}
    payload = _run(config=cfg).values[0]
    render = {**payload.context, **payload.internals}
    ctx = with_resolver_tables(strip_internals(render), render)
    out = template.resolve_variables("$rain | $rain.bool | $wind.bool", ctx)
    assert out == "heavy rain | true | false"


def test_trace_details_say_why_a_toggle_is_off_and_how_pick_one_chose():
    payload, *_ = _run().values
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    child = trace["use_own_clothes"]["detail"]
    assert child == {"switch": True, "needs": "LoRA character", "held_off": True}
    cfg = json.loads(json.dumps(PICK))
    cfg["group_upstream"] = True
    up = ContextPayload(
        context={"time": "noon", "night": "yes", "look": "Dusk"}, debug={}, internals={},
    )
    payload, *_ = _run(cfg, upstream=up).values
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    pick = trace["look"]["detail"]
    assert pick["picked"] == "Dusk" and pick["forced_by"] == "Dusk"
    assert pick["upstream_on"] == ["Night"]
    assert trace["night"]["detail"]["upstream_read"] == "yes"
