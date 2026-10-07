"""Sweep mode: WP_ContextLoop runs every combination of chosen wildcards."""

import json

from engine.pipeline import PipelineEngine
from engine.sweep import (
    PIN_KEY,
    apply_pin_override,
    parse_sweep,
    sweep_frames,
    sweep_total,
)
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext


def _axis(uid, *ids):
    return {"uid": uid, "option_ids": list(ids)}


# --- parse_sweep -----------------------------------------------------------


def test_parse_defaults_for_garbage():
    for raw in (None, "x", [], 3):
        assert parse_sweep(raw) == {
            "enabled": False, "limit": 64, "hold_others": True, "axes": [],
        }


def test_parse_drops_bad_axes_and_dedupes():
    out = parse_sweep({
        "enabled": True,
        "limit": 5000,
        "hold_others": False,
        "axes": [
            {"uid": "a1", "option_ids": ["x", "x", "", 3, "y"], "label": "hair"},
            {"uid": "a1", "option_ids": ["z"]},  # duplicate uid
            {"uid": "", "option_ids": ["z"]},  # no uid
            {"uid": "b2", "option_ids": []},  # kept, sweeps nothing
            "junk",
        ],
    })
    assert out["enabled"] is True
    assert out["limit"] == 999
    assert out["hold_others"] is False
    assert out["axes"] == [
        {"uid": "a1", "option_ids": ["x", "y"], "label": "hair"},
        {"uid": "b2", "option_ids": []},
    ]


def test_empty_axes_sweep_nothing():
    axes = [{"uid": "a", "option_ids": []}, {"uid": "b", "option_ids": ["1", "2"]}]
    assert sweep_total(axes) == 2
    assert sweep_frames(axes, 64) == [{"b": "1"}, {"b": "2"}]
    assert sweep_frames([{"uid": "a", "option_ids": []}], 64) == []


def test_parse_rejects_non_int_limit():
    assert parse_sweep({"limit": True})["limit"] == 64
    assert parse_sweep({"limit": 0})["limit"] == 1


# --- combinations ------------------------------------------------------------


def test_frames_are_row_major_last_axis_fastest():
    axes = [_axis("a", "a1", "a2"), _axis("b", "b1", "b2", "b3")]
    assert sweep_total(axes) == 6
    assert sweep_frames(axes, 64) == [
        {"a": "a1", "b": "b1"}, {"a": "a1", "b": "b2"}, {"a": "a1", "b": "b3"},
        {"a": "a2", "b": "b1"}, {"a": "a2", "b": "b2"}, {"a": "a2", "b": "b3"},
    ]


def test_frames_stop_at_limit():
    axes = [_axis("a", *[f"o{i}" for i in range(50)]), _axis("b", *[f"p{i}" for i in range(50)])]
    assert sweep_total(axes) == 2500
    frames = sweep_frames(axes, 10)
    assert len(frames) == 10
    assert frames[-1] == {"a": "o0", "b": "p9"}


def test_no_axes_no_frames():
    assert sweep_frames([], 10) == []


# --- pin override --------------------------------------------------------------


def test_pin_override_pins_only_the_named_wildcard():
    snap = {"type": "wildcard", "instance": {"mode": "random", "locked_seed": 4}}
    ctx = {PIN_KEY: {"u1": "opt-b"}}
    out = apply_pin_override(snap, "u1", ctx)
    assert out["instance"] == {"mode": "pinned", "pinned_option_id": "opt-b", "locked_seed": 4}
    assert snap["instance"]["mode"] == "random"  # caller's dict untouched
    assert apply_pin_override(snap, "u2", ctx) is snap
    combine = {"type": "combine", "instance": {}}
    assert apply_pin_override(combine, "u1", ctx) is combine


def _wildcard(uid, binding, values):
    return {
        "_uid": uid,
        "type": "wildcard",
        "payload": {
            "var_binding": binding,
            "options": [
                {"id": f"{binding}{i}", "value": v, "weight": 1.0}
                for i, v in enumerate(values)
            ],
        },
        "instance": {"variable_binding": binding},
    }


def test_pipeline_picks_the_pinned_option():
    mods = [_wildcard("u1", "hair", ["red", "blue", "green"])]
    for oid, want in (("hair0", "red"), ("hair1", "blue"), ("hair2", "green")):
        ctx = PipelineEngine().run(mods, ctx={PIN_KEY: {"u1": oid}}, seed=7)
        assert ctx["hair"] == want
    # The module list itself never gets the pin written into it.
    assert mods[0]["instance"] == {"variable_binding": "hair"}


def test_unknown_pinned_option_falls_back_to_a_roll():
    mods = [_wildcard("u1", "hair", ["red", "blue"])]
    ctx = PipelineEngine().run(mods, ctx={PIN_KEY: {"u1": "gone"}}, seed=7)
    assert ctx["hair"] in {"red", "blue"}


# --- Loop node + Context chain ---------------------------------------------------

MANY = [f"v{i}" for i in range(40)]


def _loop(config, count=1, seed=0):
    out = WPContextLoop.execute(seed=seed, count=count, wp_context_loop_config=json.dumps(config))
    return out.values[0], out.values[1]


def _context(upstream, modules, seed=11):
    raw = json.dumps({"version": 1, "modules": modules})
    return WPContext.execute(seed=seed, wp_modules=raw, upstream=upstream).values[0]


def _sweep_cfg(**kw):
    sweep = {
        "enabled": True,
        "axes": [_axis("u1", "hair0", "hair1"), _axis("u2", "mood0", "mood1", "mood2")],
    }
    sweep.update(kw)
    return {"sweep": sweep}


def test_loop_emits_one_frame_per_combination_ignoring_count():
    payloads, cfg = _loop(_sweep_cfg(), count=3)
    assert len(payloads) == 6
    assert cfg["count"] == 6
    assert cfg["sweep_total"] == 6
    assert payloads[4].internals[PIN_KEY] == {"u1": "hair1", "u2": "mood1"}
    assert payloads[4].context["iteration"] == "5"
    assert payloads[4].context["iteration_total"] == "6"


def test_loop_limit_caps_frames():
    payloads, cfg = _loop(_sweep_cfg(limit=4))
    assert len(payloads) == 4
    assert cfg["sweep_total"] == 6


def test_sweep_off_or_bypassed_ignores_axes():
    off = {"sweep": {**_sweep_cfg()["sweep"], "enabled": False}}
    payloads, cfg = _loop(off, count=2)
    assert len(payloads) == 2
    assert PIN_KEY not in payloads[0].internals
    assert "sweep_total" not in cfg
    payloads, _ = _loop({**_sweep_cfg(), "bypass": True})
    assert len(payloads) == 1
    assert PIN_KEY not in payloads[0].internals


def test_bypassed_frames_still_apply_to_a_sweep():
    payloads, _ = _loop({**_sweep_cfg(), "bypass_frames": [0, 5]})
    assert [p.internals["__wp_loop_index__"] for p in payloads] == [1, 2, 3, 4]
    assert payloads[0].internals[PIN_KEY] == {"u1": "hair0", "u2": "mood1"}


def test_chain_walks_the_grid_and_holds_other_picks():
    payloads, _ = _loop(_sweep_cfg())
    first = [_wildcard("u1", "hair", ["red", "blue"]), _wildcard("x1", "pose", MANY)]
    second = [_wildcard("u2", "mood", ["calm", "angry", "sad"]), _wildcard("x2", "light", MANY)]
    seen = []
    for p in payloads:
        out = _context(_context(p, first), second, seed=99)
        seen.append(out.context)
    assert [(c["hair"], c["mood"]) for c in seen] == [
        ("red", "calm"), ("red", "angry"), ("red", "sad"),
        ("blue", "calm"), ("blue", "angry"), ("blue", "sad"),
    ]
    # Hold other picks (default): the unswept wildcards never change.
    assert len({c["pose"] for c in seen}) == 1
    assert len({c["light"] for c in seen}) == 1


def test_chain_without_hold_lets_other_picks_vary():
    payloads, _ = _loop(_sweep_cfg(hold_others=False))
    first = [_wildcard("u1", "hair", ["red", "blue"]), _wildcard("x1", "pose", MANY)]
    poses = {_context(p, first).context["pose"] for p in payloads}
    assert len(poses) > 1
