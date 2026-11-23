"""Backward rules see targets in the WP Context nodes after this one."""
from __future__ import annotations

import json

from engine.chain_ahead import downstream_modules
from engine.modules._backward import AHEAD_KEY
from engine.pipeline import PipelineEngine
from tests.engine.test_backward_rules import _places, _poses, _rule


def _ctx_node(upstream: str | None, modules: list | str = "[]") -> dict:
    raw = modules if isinstance(modules, str) else json.dumps(modules)
    inputs: dict = {"seed": 0, "wp_modules": raw}
    if upstream is not None:
        inputs["upstream"] = [upstream, 0]
    return {"class_type": "WP_Context", "inputs": inputs}


def test_follows_a_straight_line_over_pass_through_nodes():
    prompt = {
        "1": _ctx_node(None),
        "2": {"class_type": "WP_Toggles", "inputs": {"upstream": ["1", 0], "wp_toggles": "{}"}},
        "3": _ctx_node("2", "B"),
        "4": _ctx_node("3", "C"),
        "5": {"class_type": "WP_PromptAssembler", "inputs": {"context": ["4", 0]}},
    }
    assert downstream_modules(prompt, "1") == ["B", "C"]
    assert downstream_modules(prompt, 3) == ["C"]


def test_a_branch_or_a_loop_ends_the_line():
    branch = {"1": _ctx_node(None), "2": _ctx_node("1", "B"), "3": _ctx_node("1", "C")}
    assert downstream_modules(branch, "1") == []
    loop = {"1": _ctx_node(None),
            "2": {"class_type": "WP_ContextLoop", "inputs": {"upstream": ["1", 0]}},
            "3": _ctx_node("2", "B")}
    assert downstream_modules(loop, "1") == []
    assert downstream_modules(None, "1") == []
    assert downstream_modules({"1": _ctx_node(None), "2": _ctx_node("1", "B")}, "1", limit=0) == []


def test_a_locked_target_in_a_later_node_keeps_the_source_fitting():
    later = [_places({"mode": "pinned", "pinned_option_id": "bed"})]
    for seed in range(40):
        ctx = PipelineEngine().run([_poses(), _rule()], ctx={AHEAD_KEY: [later]}, seed=seed)
        assert ctx["pose"] == "lying", seed
        assert AHEAD_KEY not in ctx
        assert "place" not in ctx  # the later node's modules never run here


def test_without_later_nodes_the_source_rolls_as_before():
    poses = {PipelineEngine().run([_poses(), _rule()], seed=s)["pose"] for s in range(40)}
    assert len(poses) > 1
