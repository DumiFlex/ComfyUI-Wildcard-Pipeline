"""D1: held wildcards must propagate their frame-0 pick + constraint-hit state
to later frames so constraints keyed on a held source keep applying — fixing
the cross-node held-target drift (outfit=yukata frame 1, school uniform 2+) and
the spurious warning flood. See docs/superpowers/plans/2026-07-23-d1-held-constraint.md.
"""
from engine.pipeline import PipelineEngine
from engine.seed_derive import effective_chain_seed


def _run(modules, *, widget_seed, loop_index, ctx=None):
    chain = effective_chain_seed(widget_seed=widget_seed, seed_override=None, loop_index=loop_index)
    hold = effective_chain_seed(widget_seed=widget_seed, seed_override=None, loop_index=0)
    return PipelineEngine().run(modules, ctx=ctx, seed=chain, hold_seed=hold, loop_index=loop_index)


def _wildcard(mid, binding, options, *, seed_scope=None):
    # options: list of (value, [tags]) or (value, [tags], weight)
    inst = {"variable_binding": binding}
    if seed_scope:
        inst["seed_scope"] = seed_scope
    built = []
    for i, opt in enumerate(options):
        v, t = opt[0], opt[1]
        w = float(opt[2]) if len(opt) > 2 else 1.0
        built.append({"id": f"{mid}-{i}", "value": v, "weight": w, "sub_categories": list(t)})
    return {
        "id": mid, "_uid": mid + "-u", "type": "wildcard",
        "payload": {"var_binding": binding, "options": built},
        "instance": inst,
    }


def _constraint(mid, src, tgt, matrix):
    return {
        "id": mid, "_uid": mid + "-u", "type": "constraint",
        "payload": {"source_wildcard_id": src, "target_wildcard_id": tgt,
                    "matrix": matrix, "exceptions": []},
        "instance": {},
    }


_CROSS = ("__wp_picks__", "__wp_constraints__", "__wp_constraint_hits__",
          "__wp_internal_flags__", "__wp_loop_index__", "__wp_seed_override__",
          "__wp_loop_seeds__")


def _run_chain(node_a, node_b, *, widget_seed, loop_index):
    """Mirror wp_nodes/context_node.py: run node A, then node B carrying only
    public vars + the cross-node internal keys (the socket boundary)."""
    ca = _run(node_a, widget_seed=widget_seed, loop_index=loop_index)
    carried = {k: v for k, v in ca.items() if not k.startswith("__")}
    for k in _CROSS:
        if k in ca:
            carried[k] = ca[k]
    return _run(node_b, widget_seed=widget_seed, loop_index=loop_index, ctx=carried)


def test_held_source_registers_pick_on_later_frames():
    """Task 1: a held wildcard's pick lands in __wp_picks__ on a non-anchor
    frame, just as at frame 0 — so downstream constraints can find it."""
    src = _wildcard("aaaa1111", "src", [("warm", ["warm"])], seed_scope="hold")
    ctx = _run([src], widget_seed=7, loop_index=3)
    assert "aaaa1111" in ctx.get("__wp_picks__", {}), "held source pick missing on frame 4"
    assert ctx["__wp_picks__"]["aaaa1111"]["value"] == "warm"


def test_cross_node_held_target_stays_constrained():
    """Task 2 (load-bearing): env (node A, held, tag `trad`) constrains outfit
    (node B, held) to exclude `casual`, so the constrained pick is always
    `kimono`. Held to frame 0 → kimono on every frame. Before the fix, env's
    held pick never reaches node B's base pass, the exclude doesn't apply, and
    the held outfit drifts to the unconstrained pick."""
    env = _wildcard("env00001", "environment", [("festival", ["trad"])], seed_scope="hold")
    outfit = _wildcard(
        "out00001", "outfit",
        [("casual", ["casual"], 1000000.0), ("kimono", ["kimono"], 1.0)],
        seed_scope="hold",
    )
    con = _constraint("con00001", "env00001", "out00001",
                      {"trad": {"casual": {"mode": "exclude", "factor": 0}}})
    outfits = [_run_chain([env], [con, outfit], widget_seed=13, loop_index=k)["outfit"]
               for k in range(4)]
    assert set(outfits) == {"kimono"}, f"held outfit drifted: {outfits}"


def test_no_spurious_warnings_for_held_source_constraint():
    """Task 3: a held-source constraint that DID apply at frame 0 must not
    report `source_missing` / `never_applied` on later frames."""
    env = _wildcard("env00002", "environment", [("festival", ["trad"])], seed_scope="hold")
    outfit = _wildcard(
        "out00002", "outfit",
        [("casual", ["casual"], 1000000.0), ("kimono", ["kimono"], 1.0)],
        seed_scope="hold",
    )
    con = _constraint("con00002", "env00002", "out00002",
                      {"trad": {"casual": {"mode": "exclude", "factor": 0}}})
    ctx = _run_chain([env], [con, outfit], widget_seed=13, loop_index=2)
    kinds = {w.get("type") for w in ctx.get("__wp_warnings__", []) if isinstance(w, dict)}
    assert "constraint_source_missing" not in kinds
    assert "constraint_never_applied" not in kinds
