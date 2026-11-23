"""Lock value — the row lock's third state (`locked_option_id`).

The wildcard always takes the locked option, a constraint's source looks
ahead at it like any lock, a sweep pin wins over it, and every single pick
is noted by `_uid` so the Context node can hand it to the lock button.
"""
from __future__ import annotations

from engine.modules.wildcard_handler import OPTION_PICKS_KEY
from engine.pipeline import PipelineEngine
from tests.engine.test_backward_rules import _places, _poses, _rule


def _run(modules, seed):
    return PipelineEngine().run(modules, seed=seed)


def test_value_lock_always_takes_the_option():
    for seed in range(30):
        ctx = _run([_places({"locked_option_id": "hammock"})], seed)
        assert ctx["place"] == "hammock"


def test_value_lock_wins_over_a_seed_lock():
    ctx = _run([_places({"locked_option_id": "street", "locked_seed": 3})], 11)
    assert ctx["place"] == "street"


def test_value_lock_narrows_the_source_backward():
    for seed in range(40):
        ctx = _run([_poses(), _rule(), _places({"locked_option_id": "bed"})], seed)
        assert ctx["place"] == "bed"
        assert ctx["pose"] == "lying", seed


def test_sweep_pin_wins_over_value_lock():
    inst = {"locked_option_id": "bed", "mode": "pinned", "pinned_option_id": "street"}
    assert _run([_places(inst)], 1)["place"] == "street"


def test_missing_locked_option_rolls_and_warns():
    ctx = _run([_places({"locked_option_id": "gone"})], 5)
    assert ctx["place"] in {"armchair", "park bench", "bed", "hammock", "street"}
    assert any(w.get("type") == "pinned_option_missing" for w in ctx["__wp_warnings__"])


def test_picks_are_noted_by_uid():
    ctx = _run([_poses(), _places({"locked_option_id": "bed"})], 9)
    picks = ctx[OPTION_PICKS_KEY]
    assert picks["plac0001"] == "bed"
    assert picks["pose0001"] in {"sitting", "lying", "standing"}
    assert ctx["pose"] == picks["pose0001"]


def test_multi_pick_notes_every_pick_in_order():
    ctx = _run([_poses({"pick_min": 2, "pick_max": 2})], 3)
    got = ctx[OPTION_PICKS_KEY]["pose0001"]
    assert isinstance(got, list) and len(got) == 2
    assert str(ctx["pose"]) == ", ".join(got)


def test_locked_value_clash_warns():
    # Pose locked to sitting, place locked to bed: the rule can't be kept.
    mods = [_poses({"locked_option_id": "sitting"}), _rule(), _places({"locked_option_id": "bed"})]
    ctx = _run(mods, 2)
    assert ctx["pose"] == "sitting"
    assert ctx["place"] == "bed"
    assert any(w.get("type") == "locked_value_conflict" for w in ctx["__wp_warnings__"])
