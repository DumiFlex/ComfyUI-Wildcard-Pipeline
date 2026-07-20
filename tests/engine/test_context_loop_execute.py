"""Tests for wp_nodes/context_loop.py.

Covers the recovery-friendly `_parse_config` helper + the `WPContextLoop`
execute path (single-iteration, multi-iteration, bypass, override on/off,
iteration var stamping).
"""

import json

import pytest

from wp_nodes.context_loop import WPContextLoop, _parse_config

_DEFAULTS = {
    "strategy": "hash_index",
    "override_seed": False,
    "iteration_var_name": "iteration",
    "bypass": False,
    "iteration_internal": True,
    "total_internal": True,
    "seed_locks": {},
    "bypass_frames": [],
}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("", _DEFAULTS),
        ("{}", _DEFAULTS),
        ("not json", _DEFAULTS),
        ("[1, 2, 3]", _DEFAULTS),
        (
            '{"strategy": "sequential", "override_seed": true, '
            '"iteration_var_name": "idx", "bypass": true}',
            {"strategy": "sequential", "override_seed": True,
             "iteration_var_name": "idx", "bypass": True,
             "iteration_internal": True, "total_internal": True,
             "seed_locks": {}, "bypass_frames": []},
        ),
        (
            '{"strategy": "wat", "override_seed": true}',
            {"strategy": "hash_index", "override_seed": True,
             "iteration_var_name": "iteration", "bypass": False,
             "iteration_internal": True, "total_internal": True,
             "seed_locks": {}, "bypass_frames": []},
        ),
        ('{"iteration_var_name": "   "}', _DEFAULTS),
        (
            '{"iteration_internal": true, "total_internal": true}',
            {**_DEFAULTS, "iteration_internal": True, "total_internal": True},
        ),
    ],
)
def test_parse_config(raw, expected):
    assert _parse_config(raw) == expected


def _execute(seed, count, config_dict):
    """Call WPContextLoop.execute and unwrap the NodeOutput.

    Stub `NodeOutput.values` is a tuple of positional args; real ComfyUI
    runtime uses the same surface. The first element is our payload list.
    """
    config_json = json.dumps(config_dict)
    result = WPContextLoop.execute(seed=seed, count=count, wp_context_loop_config=config_json)
    if hasattr(result, "values"):
        return result.values[0]
    return result


def test_execute_count_one_emits_single_payload():
    payloads = _execute(42, 1, {"strategy": "hash_index"})
    assert isinstance(payloads, list)
    assert len(payloads) == 1
    assert payloads[0].internals["__wp_loop_index__"] == 0
    assert payloads[0].internals["__wp_seed_override__"] is None


def test_execute_count_three_emits_three_payloads():
    payloads = _execute(42, 3, {"strategy": "sequential"})
    assert len(payloads) == 3
    for i, p in enumerate(payloads):
        assert p.internals["__wp_loop_index__"] == i


def test_execute_bypass_collapses_to_one_iteration():
    payloads = _execute(42, 5, {"bypass": True})
    assert len(payloads) == 1


def test_execute_override_off_leaves_seed_override_none():
    payloads = _execute(42, 3, {"override_seed": False, "strategy": "sequential"})
    assert all(p.internals["__wp_seed_override__"] is None for p in payloads)
    assert all("__wp_loop_seeds__" not in p.internals for p in payloads)


def test_execute_override_on_stamps_derived_series():
    payloads = _execute(42, 3, {"override_seed": True, "strategy": "sequential"})
    assert payloads[0].internals["__wp_seed_override__"] == 42
    assert payloads[1].internals["__wp_seed_override__"] == 43
    assert payloads[2].internals["__wp_seed_override__"] == 44
    assert payloads[0].internals["__wp_loop_seeds__"] == [42, 43, 44]


def test_execute_iteration_var_default():
    # 1-based — user-facing counter reads naturally in templates.
    # Internal `__wp_loop_index__` stays 0-based (engine seed math).
    payloads = _execute(42, 2, {})
    assert payloads[0].context == {"iteration": "1", "iteration_total": "2"}
    assert payloads[1].context == {"iteration": "2", "iteration_total": "2"}


def test_execute_iteration_var_custom_name():
    payloads = _execute(42, 2, {"iteration_var_name": "idx"})
    assert payloads[0].context == {"idx": "1", "idx_total": "2"}
    assert payloads[1].context == {"idx": "2", "idx_total": "2"}


def test_execute_count_clamps_to_one_min():
    payloads = _execute(42, 0, {})
    assert len(payloads) == 1


def test_execute_no_internal_flags_when_off():
    # Explicitly opt both flags out — asserts no internal_flags entry.
    payloads = _execute(42, 2, {
        "iteration_var_name": "idx",
        "iteration_internal": False,
        "total_internal": False,
    })
    for p in payloads:
        assert "__wp_internal_flags__" not in p.internals


def test_execute_default_config_internal_flags_both_set():
    # Empty config uses defaults: both iteration + total are internal.
    payloads = _execute(42, 2, {})
    for p in payloads:
        flags = p.internals["__wp_internal_flags__"]
        assert flags == {"iteration": True, "iteration_total": True}


def test_execute_iteration_internal_stamps_flag():
    # Opt total out so only iteration appears in flags.
    payloads = _execute(42, 2, {
        "iteration_var_name": "idx",
        "iteration_internal": True,
        "total_internal": False,
    })
    for p in payloads:
        flags = p.internals["__wp_internal_flags__"]
        assert flags == {"idx": True}


def test_execute_total_internal_stamps_flag():
    # Opt iteration out so only total appears in flags.
    payloads = _execute(42, 2, {
        "iteration_var_name": "idx",
        "iteration_internal": False,
        "total_internal": True,
    })
    for p in payloads:
        flags = p.internals["__wp_internal_flags__"]
        assert flags == {"idx_total": True}


def test_execute_both_internal_flags_stamped():
    payloads = _execute(42, 2, {
        "iteration_var_name": "iteration",
        "iteration_internal": True,
        "total_internal": True,
    })
    for p in payloads:
        flags = p.internals["__wp_internal_flags__"]
        assert flags == {"iteration": True, "iteration_total": True}


# --------------------------------------------- loop_config side output ---


def _execute_full(seed, count, config_dict):
    """Same as ``_execute`` but returns the full NodeOutput.values tuple."""
    config_json = json.dumps(config_dict)
    result = WPContextLoop.execute(seed=seed, count=count, wp_context_loop_config=config_json)
    return result.values


def test_execute_emits_loop_config_payload_on_second_output():
    """The second output is the resolved config dict — count / strategy /
    base_seed / override_seed — for WP_SeedList + friends to mirror the
    loop's series."""
    values = _execute_full(42, 3, {"strategy": "sequential", "override_seed": True})
    assert len(values) == 2
    loop_config = values[1]
    assert loop_config == {
        "count": 3,
        "active_count": 3,
        "strategy": "sequential",
        "base_seed": 42,
        "override_seed": True,
    }


def test_loop_config_count_reflects_bypass_collapse():
    """Bypass collapses to effective_count=1, and the side output must
    reflect what the loop is ACTUALLY running, not the raw widget."""
    values = _execute_full(42, 5, {"bypass": True})
    loop_config = values[1]
    assert loop_config["count"] == 1


def test_loop_config_strategy_falls_back_to_default_on_unknown():
    """_parse_config sanitises unknown strategies to the default —
    the side output reflects the resolved strategy."""
    values = _execute_full(42, 3, {"strategy": "wat"})
    loop_config = values[1]
    assert loop_config["strategy"] == "hash_index"
