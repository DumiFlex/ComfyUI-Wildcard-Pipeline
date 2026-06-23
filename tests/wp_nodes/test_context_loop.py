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
