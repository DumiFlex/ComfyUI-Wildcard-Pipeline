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


def _wildcard(binding, values, *, seed_scope=None):
    instance = {"variable_binding": binding}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    options = [{"id": str(i), "value": v, "weight": 1.0} for i, v in enumerate(values)]
    return {
        "type": "wildcard",
        "payload": {"var_binding": binding, "options": options},
        "instance": instance,
    }


VALUES = ["a", "b", "c", "d", "e", "f", "g", "h"]


def test_hold_wildcard_is_identical_across_iterations():
    held = [
        _run([_wildcard("x", VALUES, seed_scope="hold")], widget_seed=42, loop_index=k)["x"]
        for k in range(4)
    ]
    assert len(set(held)) == 1


def test_vary_wildcard_changes_across_iterations():
    varied = [_run([_wildcard("x", VALUES)], widget_seed=42, loop_index=k)["x"] for k in range(6)]
    assert len(set(varied)) > 1


def test_locked_seed_wins_over_hold():
    m = _wildcard("x", VALUES, seed_scope="hold")
    m["instance"]["locked_seed"] = 12345
    a = _run([m], widget_seed=42, loop_index=0)["x"]
    b = _run([m], widget_seed=999, loop_index=7)["x"]
    assert a == b


def _combine(output_var, template, *, seed_scope=None):
    instance = {}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    return {
        "type": "combine",
        "payload": {"output_var": output_var, "template": template},
        "instance": instance,
    }


COMBINE_TMPL = "{alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel}"


def test_hold_combine_is_identical_across_iterations():
    held = [
        _run([_combine("y", COMBINE_TMPL, seed_scope="hold")], widget_seed=42, loop_index=k)["y"]
        for k in range(4)
    ]
    assert len(set(held)) == 1


def test_vary_combine_changes_across_iterations():
    varied = [
        _run([_combine("y", COMBINE_TMPL)], widget_seed=42, loop_index=k)["y"]
        for k in range(6)
    ]
    assert len(set(varied)) > 1
