"""Wildcard fallback option (schema v9): one option flagged ``fallback`` is
reserved for when nothing else is left to pick."""
import random

import pytest

from engine.modules import build_resolve_ctx
from engine.modules.wildcard_handler import WildcardHandler
from engine.pipeline import PipelineEngine
from engine.syntax import resolve_text

_SRC = "12345678"
_TGT = "abcdef01"


def _ctx():
    return {
        "__wp_rng__": random.Random(0),
        "__wp_node_seed__": 42,
        "__wp_warnings__": [],
        "__wp_current_module_id__": "abc12345",
    }


def _shoes(*, fallback=True, extra_weight=1):
    options = [
        {"id": "t1", "value": "sneakers", "weight": extra_weight, "sub_categories": ["casual"]},
        {"id": "t2", "value": "boots", "weight": extra_weight, "sub_categories": ["casual"]},
    ]
    if fallback:
        options.append({"id": "fb", "value": "shoes", "weight": 1, "fallback": True})
    return {"options": options, "sub_categories": ["casual"], "var_binding": "shoes"}


def _chain(target_payload, *, target_instance=None):
    return [
        {
            "type": "wildcard",
            "id": _SRC,
            "payload": {
                "options": [{"id": "s1", "value": "tee", "sub_categories": ["formal"]}],
                "sub_categories": ["formal"],
                "var_binding": "outfit",
            },
            "instance": {"variable_binding": "outfit"},
        },
        {
            "type": "constraint",
            "id": "con00001",
            "payload": {
                "source_wildcard_id": _SRC,
                "target_wildcard_id": _TGT,
                "matrix": {"formal": {"casual": {"mode": "exclude", "factor": 0.0}}},
                "exceptions": [],
            },
            "instance": {},
        },
        {
            "type": "wildcard",
            "id": _TGT,
            "payload": target_payload,
            "instance": {"variable_binding": "shoes", **(target_instance or {})},
        },
    ]


def _types(out):
    return [w["type"] for w in out["__wp_warnings__"]]


def test_constraint_excluding_everything_uses_the_fallback():
    out = PipelineEngine().run(_chain(_shoes()), seed=1)
    assert out["shoes"] == "shoes"
    assert "fallback_used" in _types(out)
    assert "constraint_excludes_all_options" not in _types(out)
    note = next(w for w in out["__wp_warnings__"] if w["type"] == "fallback_used")
    assert note["severity"] == "info"
    assert note["detail"]["reason"] == "constraints"
    assert note["detail"]["option_id"] == "fb"


def test_without_a_fallback_the_old_empty_result_and_warning_stand():
    out = PipelineEngine().run(_chain(_shoes(fallback=False)), seed=1)
    assert out["shoes"] == ""
    assert "constraint_excludes_all_options" in _types(out)
    assert "fallback_used" not in _types(out)


@pytest.mark.parametrize("seed", range(40))
def test_fallback_never_rolls_while_anything_is_live(seed):
    ctx = _ctx()
    ctx["__wp_node_seed__"] = seed
    out = WildcardHandler.resolve(_shoes(), {"variable_binding": "shoes"}, ctx)
    assert out["shoes"] in {"sneakers", "boots"}
    assert ctx["__wp_warnings__"] == []


def test_fallback_keeps_normal_picks_identical_to_no_fallback():
    for seed in range(20):
        a, b = _ctx(), _ctx()
        a["__wp_node_seed__"] = b["__wp_node_seed__"] = seed
        with_fb = WildcardHandler.resolve(_shoes(), {"variable_binding": "shoes"}, a)
        without = WildcardHandler.resolve(
            _shoes(fallback=False), {"variable_binding": "shoes"}, b,
        )
        assert with_fb == without


def test_all_weights_zero_uses_the_fallback():
    ctx = _ctx()
    out = WildcardHandler.resolve(
        _shoes(extra_weight=0), {"variable_binding": "shoes"}, ctx,
    )
    assert out == {"shoes": "shoes"}
    note = ctx["__wp_warnings__"][0]
    assert note["type"] == "fallback_used"
    assert note["detail"]["reason"] == "empty_pool"


def test_toggled_off_fallback_is_not_used():
    out = PipelineEngine().run(
        _chain(_shoes(), target_instance={"enabled_options": ["t1", "t2"]}), seed=1,
    )
    assert out["shoes"] == ""
    assert "constraint_excludes_all_options" in _types(out)


def test_fallback_is_used_when_the_toggles_leave_only_it():
    ctx = _ctx()
    out = WildcardHandler.resolve(
        _shoes(), {"variable_binding": "shoes", "enabled_options": ["fb"]}, ctx,
    )
    assert out == {"shoes": "shoes"}


def test_multi_pick_uses_the_fallback_once():
    out = PipelineEngine().run(
        _chain(_shoes(), target_instance={"pick_min": 2, "pick_max": 3}), seed=1,
    )
    assert str(out["shoes"]) == "shoes"


def test_independent_multi_pick_does_not_repeat_the_fallback():
    out = PipelineEngine().run(
        _chain(_shoes(), target_instance={
            "pick_min": 3, "pick_max": 3, "pick_independent": True,
        }),
        seed=1,
    )
    assert str(out["shoes"]) == "shoes"


def test_fallback_pick_is_recorded_for_downstream_constraints():
    out = PipelineEngine().run(_chain(_shoes()), seed=1)
    assert out["__wp_picks__"][_TGT]["value"] == "shoes"


def _nested_ctx(fallback=True):
    options = [
        {"id": "yes", "value": "red", "weight": 1, "sub_categories": ["bad"]},
        {"id": "no", "value": "blue", "weight": 1, "sub_categories": ["bad"]},
    ]
    if fallback:
        options.append({"id": "fb", "value": "plain", "weight": 1, "fallback": True})
    return {
        "__wp_rng__": random.Random(1),
        "__wp_warnings__": [],
        "__wp_catalog__": {_TGT: {"var_binding": "colour", "options": options}},
        "__wp_constraints__": [{
            "source_wildcard_id": _SRC, "target_wildcard_id": _TGT,
            "matrix": {"src": {"bad": {"mode": "exclude", "factor": 0.0}}},
            "exceptions": [],
            "target_select": {"mode": "all"},
            "__constraint_module_id__": "cn-uid",
        }],
        "__wp_picks__": {_SRC: {
            "value": "sv", "sub_categories": ["src"],
            "picks": [{"value": "sv", "tags": ["src"]}],
        }},
        "__wp_constraint_hits__": {},
        "__wp_max_ref_depth__": 8,
    }


def test_nested_ref_uses_the_fallback():
    ctx = _nested_ctx()
    rctx = build_resolve_ctx(ctx, surface="wildcard")
    assert resolve_text(f"@{{{_TGT}}}", rctx) == "plain"
    assert any(w["type"] == "fallback_used" for w in rctx.warnings)


def test_nested_ref_without_fallback_stays_empty():
    ctx = _nested_ctx(fallback=False)
    rctx = build_resolve_ctx(ctx, surface="wildcard")
    assert resolve_text(f"@{{{_TGT}}}", rctx) == ""


def test_nested_multi_pick_uses_the_fallback_once():
    ctx = _nested_ctx()
    rctx = build_resolve_ctx(ctx, surface="wildcard")
    assert resolve_text(f"{{2$$, $$@{{{_TGT}}}}}", rctx) == "plain"


@pytest.mark.parametrize("bad, msg", [
    ({"id": "x", "value": "x", "fallback": "yes"}, "must be a boolean"),
    ({"id": "x", "value": "", "is_null": True, "fallback": True}, "can't be the fallback"),
])
def test_validation_rejects_bad_fallback_flags(bad, msg):
    payload = {"options": [{"id": "a", "value": "a"}, bad], "var_binding": "v"}
    with pytest.raises(ValueError, match=msg):
        WildcardHandler.validate_payload(payload)


def test_validation_allows_one_fallback_only():
    payload = {"options": [
        {"id": "a", "value": "a", "fallback": True},
        {"id": "b", "value": "b", "fallback": True},
    ], "var_binding": "v"}
    with pytest.raises(ValueError, match="at most one fallback"):
        WildcardHandler.validate_payload(payload)
    payload["options"][1]["fallback"] = False
    WildcardHandler.validate_payload(payload)
