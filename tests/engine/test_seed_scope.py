from engine.pipeline import PipelineEngine
from engine.seed_derive import effective_chain_seed


def _run(modules, *, widget_seed, loop_index):
    """Run the engine the way wp_nodes/context_node.py does: a per-iteration
    chain seed plus a held seed (loop_index pinned to 0)."""
    chain_seed = effective_chain_seed(
        widget_seed=widget_seed, seed_override=None, loop_index=loop_index
    )
    hold_seed = effective_chain_seed(
        widget_seed=widget_seed, seed_override=None, loop_index=0
    )
    return PipelineEngine().run(
        modules, seed=chain_seed, hold_seed=hold_seed, loop_index=loop_index
    )


def test_run_exposes_hold_seed_and_loop_index_in_ctx():
    ctx = _run([], widget_seed=42, loop_index=3)
    expected_hold = effective_chain_seed(
        widget_seed=42, seed_override=None, loop_index=0
    )
    assert ctx["__wp_loop_index__"] == 3
    assert ctx["__wp_node_seed_hold__"] == expected_hold
    assert ctx["__wp_node_seed__"] != ctx["__wp_node_seed_hold__"]
