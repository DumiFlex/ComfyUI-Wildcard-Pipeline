"""Node-level tests for WP_ContextLoop seed_locks parsing + execution.

Covers _parse_config seed_locks extraction (int-key coercion, defaults,
malformed-entry dropping) and the execute path with seed locks applied
when override_seed is on.
"""

import json

from wp_nodes.context_loop import WPContextLoop, _parse_config


def test_parse_config_reads_seed_locks_as_int_map():
    cfg = _parse_config(json.dumps({"seed_locks": {"1": 999, "3": 888}}))
    assert cfg["seed_locks"] == {1: 999, 3: 888}


def test_parse_config_defaults_seed_locks_empty():
    assert _parse_config("{}")["seed_locks"] == {}


def test_parse_config_drops_malformed_seed_locks():
    cfg = _parse_config(json.dumps({"seed_locks": {"x": "nope", "2": 5}}))
    assert cfg["seed_locks"] == {2: 5}


def test_execute_applies_seed_locks_when_override_on():
    raw = json.dumps({"strategy": "sequential", "override_seed": True,
                      "seed_locks": {"2": 7}})
    out = WPContextLoop.execute(seed=42, count=4, wp_context_loop_config=raw)
    payloads = out.values[0]
    assert payloads[2].internals["__wp_seed_override__"] == 7
    assert payloads[0].internals["__wp_seed_override__"] == 42
    assert payloads[2].internals["__wp_loop_seeds__"] == [42, 43, 7, 45]
    # The same series surfaces to the node UI so the frontend can offer
    # "lock previous" in the seed modal.
    assert out.ui == {"loop_seeds": [[42, 43, 7, 45]]}


def test_execute_emits_empty_ui_seeds_when_override_off():
    # Override off → the Loop doesn't drive seeds, so there's no series to
    # offer; the empty UI list greys the "lock previous" button per frame.
    raw = json.dumps({"strategy": "sequential", "override_seed": False})
    out = WPContextLoop.execute(seed=42, count=4, wp_context_loop_config=raw)
    assert out.ui == {"loop_seeds": [[]]}


def test_parse_config_bypass_frames_clean():
    cfg = _parse_config('{"bypass_frames": [3, 1, 3, 0]}')
    # deduped + sorted, 0-based
    assert cfg["bypass_frames"] == [0, 1, 3]


def test_parse_config_bypass_frames_drops_junk_keeps_out_of_range():
    # non-ints + negatives dropped; large (out-of-range at any count) KEPT
    cfg = _parse_config('{"bypass_frames": [2, -1, "x", 2.0, 999]}')
    assert cfg["bypass_frames"] == [2, 999]


def test_parse_config_bypass_frames_default_and_malformed():
    assert _parse_config("{}")["bypass_frames"] == []
    assert _parse_config('{"bypass_frames": "nope"}')["bypass_frames"] == []
    assert _parse_config("not json")["bypass_frames"] == []


def _run(seed, count, cfg):
    out = WPContextLoop.execute(
        seed=seed, count=count, wp_context_loop_config=json.dumps(cfg)
    )
    return out.values[0], out.values[1]  # (payloads, loop_config)


def test_bypass_frames_emits_kept_with_pinned_index():
    # count 5, bypass frames 1 and 3 (0-based) -> kept 0,2,4
    payloads, loop_config = _run(0, 5, {"override_seed": True, "bypass_frames": [1, 3]})
    idxs = [p.internals["__wp_loop_index__"] for p in payloads]
    assert idxs == [0, 2, 4]
    # iteration counter is the ORIGINAL 1-based number; total = configured count
    assert payloads[1].context["iteration"] == "3"  # frame index 2 -> "3"
    assert all(p.context["iteration_total"] == "5" for p in payloads)
    assert loop_config["count"] == 5
    assert loop_config["active_count"] == 3


def test_bypass_pins_kept_frame_seeds():
    # A kept frame's override seed is identical with and without a DIFFERENT
    # frame bypassed (pinned identity).
    full, _ = _run(0, 5, {"override_seed": True, "bypass_frames": []})
    partial, _ = _run(0, 5, {"override_seed": True, "bypass_frames": [1]})
    seed_by_idx = {
        p.internals["__wp_loop_index__"]: p.internals["__wp_seed_override__"]
        for p in full
    }
    for p in partial:
        i = p.internals["__wp_loop_index__"]
        assert p.internals["__wp_seed_override__"] == seed_by_idx[i]


def test_bypass_all_floors_to_full_run():
    payloads, loop_config = _run(0, 3, {"bypass_frames": [0, 1, 2]})
    idxs = [p.internals["__wp_loop_index__"] for p in payloads]
    assert idxs == [0, 1, 2]
    assert loop_config["active_count"] == 3


def test_out_of_range_bypass_is_inert():
    # frame index 9 does not exist at count 3 -> ignored, all 3 emitted
    payloads, _ = _run(0, 3, {"bypass_frames": [9]})
    assert [p.internals["__wp_loop_index__"] for p in payloads] == [0, 1, 2]


def test_whole_loop_bypass_still_single_run():
    payloads, loop_config = _run(0, 8, {"bypass": True, "bypass_frames": [2, 4]})
    assert len(payloads) == 1
    assert payloads[0].internals["__wp_loop_index__"] == 0
    assert loop_config["count"] == 1
    assert loop_config["active_count"] == 1
