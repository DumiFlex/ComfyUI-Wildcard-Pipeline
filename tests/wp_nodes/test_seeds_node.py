"""Node-level tests for WP_Seeds and a WP Context reading one of its rows."""
import json
from types import SimpleNamespace

from engine import seeds
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext
from wp_nodes.seeds_node import WPSeeds
from wp_nodes.types import FRAME0_KEY

CFG = {"version": 1, "rows": [
    {"id": "aaaa0000", "kind": "label", "name": "Contexts"},
    {"id": "00000001", "kind": "seed", "name": "Direction", "mode": "follow", "locks": {"2": 99}},
    {"id": "00000002", "kind": "seed", "name": "Sampler", "mode": "fixed", "value": 1234,
     "pin": True, "out": 1},
    {"id": "00000003", "kind": "seed", "name": "Same", "mode": "fixed", "value": 5,
     "per_frame": "same", "pin": True, "out": 2},
]}


def _seeds(upstream=None, base_seed=42, config=CFG):
    WPSeeds.hidden = SimpleNamespace(unique_id="9")
    try:
        return WPSeeds.execute(upstream=upstream, base_seed=base_seed, wp_seeds=json.dumps(config))
    finally:
        del WPSeeds.hidden


def _frames(count=3, cfg="{}"):
    return WPContextLoop.execute(seed=5, count=count, wp_context_loop_config=cfg).values[0]


def test_schema():
    s = WPSeeds.define_schema()
    assert s.node_id == "WP_Seeds" and s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == ["upstream", "base_seed", "wp_seeds"]
    assert [o.name for o in s.outputs] == ["context"] + [f"seed_{i}" for i in range(1, 17)]
    assert s.not_idempotent is True


def test_without_upstream_is_frame_zero():
    out = _seeds()
    payload, *ints = out.values
    assert len(ints) == 16 and ints[:3] == [1234, 5, 0]
    rows = payload.internals[seeds.ROWS_KEY]
    assert rows["sampler"] == {"seed": 1234, "frame0": 1234}
    assert rows["direction"]["seed"] == seeds.named_seed(42, "Direction")
    assert payload.context == {}
    assert out.ui["seed_frames"][0]["frame"] == 0
    assert out.ui["seed_frames"][0]["seeds"]["00000002"] == 1234
    traces = payload.debug["__wp_trace__"]
    assert {t["detail"]["row"] for t in traces} == {"Direction", "Sampler", "Same"}


def test_per_frame_seeds_and_locks():
    frames = [_seeds(up) for up in _frames(3)]
    samplers = [f.values[1] for f in frames]
    assert samplers[0] == 1234 and len(set(samplers)) == 3
    assert [f.values[2] for f in frames] == [5, 5, 5]
    direction = [f.values[0].internals[seeds.ROWS_KEY]["direction"] for f in frames]
    assert direction[2]["seed"] == 99
    assert {d["frame0"] for d in direction} == {seeds.named_seed(42, "Direction")}
    # Frame 0's payload carries the rows too, for held modules downstream.
    assert seeds.ROWS_KEY in frames[2].values[0].internals[FRAME0_KEY]["internals"]


def _context(upstream, seed_from=None, seed=7):
    value = {"version": 1, "modules": []}
    if seed_from is not None:
        value["seed_from"] = seed_from
    WPContext.hidden = SimpleNamespace(unique_id="3")
    try:
        return WPContext.execute(seed, json.dumps(value), upstream=upstream)
    finally:
        del WPContext.hidden


def test_context_reads_its_row_per_frame():
    for idx, up in enumerate(_frames(3)):
        row = _seeds(up).values[0].internals[seeds.ROWS_KEY]["direction"]
        out = _context(_seeds(up).values[0], "row:Direction")
        assert out.ui["seed_used"] == [row["seed"]]
        assert out.ui["seed_source"] == ["row:Direction"]
        assert out.ui["frame_seeds"] == [{"frame": idx, "seed": row["seed"]}]
        # Chained Contexts still see the rows.
        assert seeds.ROWS_KEY in out.values[0].internals, idx


def test_context_missing_row_runs_auto_and_warns():
    out = _context(_seeds(_frames(1)[0]).values[0], "row:Nope")
    assert out.ui["seed_source"] == ["auto"]
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "seed_source_missing" for w in warnings)


def test_own_seed_wins_over_loop_override():
    frames = _frames(3, json.dumps({"override_seed": True}))
    auto = _context(frames[1])
    own = _context(frames[1], "own")
    assert auto.ui["seed_used"] == [frames[1].internals["__wp_seed_override__"]]
    assert own.ui["seed_source"] == ["own"]
    assert own.ui["seed_used"] != auto.ui["seed_used"]


def test_loop_seed_without_override():
    frames = _frames(3)
    out = _context(frames[2], "loop")
    assert out.ui["seed_used"] == [frames[2].internals["__wp_loop_seed__"]["seed"]]


def test_base_seed_from_loop():
    cfg = {**CFG, "base_from_loop": True}
    frames = [_seeds(up, config=cfg) for up in _frames(3)]
    direction = [f.values[0].internals[seeds.ROWS_KEY]["direction"] for f in frames]
    # The Loop's seed (5) replaces the widget's 42; frames still differ.
    assert direction[0]["seed"] == seeds.named_seed(5, "Direction")
    assert direction[1]["seed"] == seeds.frame_seed(seeds.named_seed(5, "Direction"), 1)
    assert frames[0].ui["seed_frames"][0]["base"] == 5
    # Without a Loop upstream the widget is used.
    solo = _seeds(config=cfg)
    solo_row = solo.values[0].internals[seeds.ROWS_KEY]["direction"]
    assert solo_row["seed"] == seeds.named_seed(42, "Direction")


def test_ui_reports_each_rows_start_seed():
    out = _seeds()
    bases = out.ui["seed_frames"][0]["bases"]
    assert bases == {
        "00000001": seeds.named_seed(42, "Direction"),
        "00000002": 1234,
        "00000003": 5,
    }


def test_debug_learns_where_each_context_seed_came_from():
    """WP Debug's run seed: each Context says what its seed was made from,
    and WP Seeds' trace carries its base seed (and whether the Loop set it)."""
    frames = _frames(3, json.dumps({"override_seed": True}))
    up = _seeds(frames[1]).values[0]
    def nodes(out):
        return out.values[0].debug["__wp_nodes__"]

    def detail_of(payload):
        trace = payload.debug["__wp_trace__"]
        return next(t["detail"] for t in trace if t.get("node") == "WP_Seeds")

    assert nodes(_context(up, "row:Direction"))[-1] == {
        "node_id": "3",
        "seed": up.internals[seeds.ROWS_KEY]["direction"]["seed"],
        "from": "row:Direction",
    }
    assert nodes(_context(up))[-1]["from"] == "loop"  # auto while the Loop overrides
    assert nodes(_context(up, "own"))[-1]["from"] == "own"
    assert nodes(_context(_frames(2)[1], "loop"))[-1]["from"] == "loop"
    assert nodes(_context(_frames(2)[1]))[-1]["from"] == "own"  # auto, no override
    detail = detail_of(up)
    assert detail["base"] == 42 and "base_from_loop" not in detail
    looped = _seeds(frames[1], config={**CFG, "base_from_loop": True}).values[0]
    assert detail_of(looped)["base"] == 5
    assert detail_of(looped)["base_from_loop"] is True
    # Without a Loop upstream "From Loop" can't be true.
    solo = _seeds(config={**CFG, "base_from_loop": True}).values[0]
    assert "base_from_loop" not in detail_of(solo)
