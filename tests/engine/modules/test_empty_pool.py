"""An over-narrowed pool emits nothing rather than a plausible wrong option.

`_pick_weighted` used to return `options[0]` when every weight was zero. That
looks like a working pick — it is a real option, in the right place, with the
right shape — right up until you reorder the list and the "choice" changes.
The engine already has a first-class way to say "no output": the null option.
An excluded pool now says the same thing.
"""
import random

import pytest

from engine.modules.wildcard_handler import WildcardHandler, _pick_weighted


def _opts(*weights):
    return [
        {"id": f"o{i}", "value": f"v{i}", "weight": w}
        for i, w in enumerate(weights)
    ]


def _ctx():
    return {
        "__wp_rng__": random.Random(0),
        "__wp_node_seed__": 42,
        "__wp_warnings__": [],
        "__wp_current_module_id__": "abc12345",
    }


def test_all_zero_weights_picks_nothing():
    assert _pick_weighted(_opts(0, 0, 0), random.Random(0)) is None


def test_empty_pool_still_picks_nothing():
    assert _pick_weighted([], random.Random(0)) is None


def test_a_single_live_option_still_wins():
    # The floor case: exactly one survivor must still be pickable, or the fix
    # would trade a wrong answer for no answer.
    chosen = _pick_weighted(_opts(0, 3, 0), random.Random(0))
    assert chosen is not None
    assert chosen["id"] == "o1"


@pytest.mark.parametrize("seed", range(8))
def test_weighting_is_untouched_when_anything_is_live(seed):
    picked = _pick_weighted(_opts(0, 1, 0, 0), random.Random(seed))
    assert picked is not None and picked["id"] == "o1"


def test_wildcard_with_every_option_disabled_binds_empty():
    """Weight 0 is documented as "disable without deleting". All of them
    disabled therefore means nothing is selectable — not "quietly use the
    first one anyway"."""
    payload = {
        "options": [
            {"id": "o1", "value": "tee", "weight": 0},
            {"id": "o2", "value": "gown", "weight": 0},
        ],
        "sub_categories": [],
        "var_binding": "outfit",
    }
    out = WildcardHandler.resolve(payload, {"variable_binding": "outfit"}, _ctx())
    assert out == {"outfit": ""}


def test_constraint_excluding_everything_binds_empty_and_warns():
    """The reported shape, one level up: two garments whose menus share no
    shoe intersect to nothing. Previously the target returned its first
    option forever."""
    ctx = _ctx()
    source = {
        "type": "wildcard",
        "id": "src00001",
        "payload": {
            "options": [{"id": "s1", "value": "tee", "sub_categories": ["formal"]}],
            "sub_categories": ["formal"],
            "var_binding": "outfit",
        },
        "instance": {"variable_binding": "outfit"},
    }
    target_payload = {
        "options": [
            {"id": "t1", "value": "sneakers", "weight": 1, "sub_categories": ["casual"]},
            {"id": "t2", "value": "boots", "weight": 1, "sub_categories": ["casual"]},
        ],
        "sub_categories": ["casual"],
        "var_binding": "shoes",
    }
    from engine.pipeline import PipelineEngine

    out = PipelineEngine().run([
        source,
        {
            "type": "constraint",
            "id": "con00001",
            "payload": {
                "source_wildcard_id": "src00001",
                "target_wildcard_id": "tgt00001",
                "matrix": {"formal": {"casual": {"mode": "exclude", "factor": 0.0}}},
                "exceptions": [],
            },
            "instance": {},
        },
        {
            "type": "wildcard",
            "id": "tgt00001",
            "payload": target_payload,
            "instance": {"variable_binding": "shoes"},
        },
    ], seed=1)
    assert out["shoes"] == ""
    assert any(
        w["type"] == "constraint_excludes_all_options"
        for w in out["__wp_warnings__"]
    )
    _ = ctx
