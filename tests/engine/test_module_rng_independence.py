"""Two derivation (or fixed_values) modules in one chain roll independently.

Regression: both handlers keyed their rng on `__wp_module_id__`, which the
pipeline never sets, so every derivation shared the literal "derivation"
stream (and every fixed_values the "fixed_values" stream). Two modules with
the same `{a|...|h}` alternation then picked the same option on every seed.
They now key on the module instance (`_uid`, falling back to the library id).
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine

ALT = "{a|b|c|d|e|f|g|h}"
SEEDS = range(200)


def _derivation(mid: str, uid: str, target: str) -> dict:
    return {
        "id": mid,
        "_uid": uid,
        "type": "derivation",
        "enabled": True,
        "payload": {
            "rules": [
                {
                    "id": "rule0001",
                    # Never fires (no $unset), so the else always runs.
                    "branches": [
                        {
                            "condition": {"var": "unset", "op": "equals", "value": "z"},
                            "action": {"target_var": target, "mode": "replace", "value": "z"},
                        }
                    ],
                    "else": {
                        "action": {"target_var": target, "mode": "replace", "value": ALT},
                    },
                }
            ]
        },
    }


def _fixed(mid: str, uid: str, name: str) -> dict:
    return {
        "id": mid,
        "_uid": uid,
        "type": "fixed_values",
        "enabled": True,
        "payload": {"values": [{"id": "v0", "name": name, "value": ALT}]},
    }


def _agreements(modules: list[dict], a: str, b: str) -> int:
    same = 0
    for seed in SEEDS:
        ctx = PipelineEngine().run(modules, seed=seed)
        assert ctx[a] in "abcdefgh" and ctx[b] in "abcdefgh"
        same += ctx[a] == ctx[b]
    return same


def test_two_derivations_roll_independently():
    mods = [_derivation("deriv001", "u1", "x"), _derivation("deriv002", "u2", "y")]
    # Independent 8-way picks agree ~25/200; a shared stream agrees 200/200.
    assert _agreements(mods, "x", "y") < 60


def test_two_fixed_values_roll_independently():
    mods = [_fixed("fixed001", "u1", "x"), _fixed("fixed002", "u2", "y")]
    assert _agreements(mods, "x", "y") < 60


def test_two_instances_of_one_library_derivation_roll_independently():
    # Same library id, different instance uids (the module added twice).
    mods = [_derivation("deriv001", "u1", "x"), _derivation("deriv001", "u2", "y")]
    assert _agreements(mods, "x", "y") < 60


def test_derivation_pick_is_stable_for_a_seed():
    mods = [_derivation("deriv001", "u1", "x")]
    first = [PipelineEngine().run(mods, seed=s)["x"] for s in range(20)]
    again = [PipelineEngine().run(mods, seed=s)["x"] for s in range(20)]
    assert first == again


def test_locked_seed_reproduces_the_unlocked_pick():
    # Lock contract: locking a module to the seed it rolled on reproduces it.
    for seed in range(20):
        unlocked = PipelineEngine().run([_derivation("deriv001", "u1", "x")], seed=seed)["x"]
        locked_mod = _derivation("deriv001", "u1", "x")
        locked_mod["instance"] = {"locked_seed": seed}
        locked = PipelineEngine().run([locked_mod], seed=seed + 1000)["x"]
        assert locked == unlocked
