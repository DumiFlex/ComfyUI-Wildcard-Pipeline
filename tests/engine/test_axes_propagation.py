"""`__wp_axes__` has to reach every consumer, not just the node that rolled it.

Two guarantees, both already load-bearing for `__wp_picks__` and both easy to
break silently: a `$outfit.SHOES` read renders `""` rather than erroring, so a
dropped key looks like a content problem rather than a plumbing one.
"""
from engine.pipeline import PipelineEngine
from wp_nodes.types import _CROSS_NODE_INTERNAL_KEYS

# `PipelineEngine.run` is annotated `list[Module]`, but Module aliases the
# fixed_values dataclass and every caller — engine and test alike — passes
# plain dicts. Matching the convention the other engine tests use rather than
# pretending to satisfy a stale annotation.


def _wildcard(binding: str, seed_scope: str | None = None) -> dict:
    return {
        "type": "wildcard",
        "id": "abc12345",
        "payload": {
            "options": [
                {"id": "o1", "value": "tee", "sub_categories": ["sneakers"]},
                {"id": "o2", "value": "gown", "sub_categories": ["sandals"]},
            ],
            "sub_categories": ["sneakers", "sandals"],
            "tag_groups": {"SHOES": ["sneakers", "sandals"]},
            "tag_group_kinds": {"SHOES": "accepts"},
            "var_binding": binding,
        },
        "instance": (
            {"variable_binding": binding, "seed_scope": seed_scope}
            if seed_scope else {"variable_binding": binding}
        ),
    }


def test_axes_key_crosses_node_boundaries():
    # Without this the second Context node in a chain sees no axis at all and
    # every `$outfit.SHOES` downstream of the first node renders "".
    assert "__wp_axes__" in _CROSS_NODE_INTERNAL_KEYS


def test_held_axis_is_frozen_across_iterations():
    """A held wildcard early-returns before recording, so without the
    carry-forward its axis vanishes on iteration 2+ and reads render ""."""
    modules = [_wildcard("outfit", seed_scope="hold")]
    first = PipelineEngine().run(modules, seed=7, hold_seed=7, loop_index=0)
    later = PipelineEngine().run(modules, seed=99, hold_seed=7, loop_index=3)
    assert later["__wp_axes__"]["outfit"] == first["__wp_axes__"]["outfit"]


def test_unheld_axis_still_rerolls_each_iteration():
    """The carry-forward must not pin a wildcard that never asked to hold —
    `setdefault` rather than assignment is what keeps this true."""
    modules = [_wildcard("outfit"), _wildcard("other", seed_scope="hold")]
    modules[1]["id"] = "def67890"
    runs = {
        PipelineEngine()
        .run(modules, seed=s, hold_seed=7, loop_index=i)["__wp_axes__"]["outfit"]["SHOES"]
        for i, s in enumerate([11, 22, 33, 44, 55, 66], start=1)
    }
    # Six different seeds over a two-tag menu: a pinned value would collapse
    # this to one entry.
    assert len(runs) == 2


# ── accepts source drives the constraint by its ROLLED tag (source fix + A) ──

_SHOES = ["sneakers", "sandals", "boots"]


def _src_accepts():
    # One 2-tag option, so the accepts axis has a real choice and the source
    # sends only its rolled winner to the constraint.
    return {
        "type": "wildcard", "id": "src00001", "_uid": "src00001",
        "payload": {
            "var_binding": "outfit",
            "sub_categories": _SHOES,
            "tag_groups": {"SHOES": _SHOES},
            "tag_group_kinds": {"SHOES": "accepts"},
            "options": [{"id": "s1", "value": "outfitA", "weight": 1,
                         "sub_categories": ["sneakers", "sandals"]}],
        },
        "instance": {"variable_binding": "outfit"},
    }


def _diagonal():
    m = {s: {t: ({"mode": "allow", "factor": 1.0} if s == t
                 else {"mode": "exclude", "factor": 0.0}) for t in _SHOES}
         for s in _SHOES}
    return {"type": "constraint", "id": "con00001", "_uid": "con00001",
            "payload": {"source_wildcard_id": "src00001",
                        "target_wildcard_id": "tgt00001",
                        "matrix": m, "exceptions": []}, "instance": {}}


def _target(kind):
    # Single-tag shoe options (the realistic pool shape).
    payload = {
        "var_binding": "shoes",
        "sub_categories": _SHOES,
        "tag_groups": {"SHOES": _SHOES},
        "options": [{"id": f"t_{s}", "value": s, "weight": 1, "sub_categories": [s]}
                    for s in _SHOES],
    }
    if kind == "accepts":
        payload["tag_group_kinds"] = {"SHOES": "accepts"}
    return {"type": "wildcard", "id": "tgt00001", "_uid": "tgt00001",
            "payload": payload, "instance": {"variable_binding": "shoes"}}


def test_accepts_source_diagonal_pins_target_to_the_rolled_tag():
    # Source fix: the accepts source sends only its rolled winner, so a diagonal
    # forces the (classify) target to the shoe of that exact tag — never the
    # whole accepted set.
    for seed in range(12):
        ctx = PipelineEngine().run(
            [_src_accepts(), _diagonal(), _target("classify")], seed=seed)
        won = ctx["__wp_axes__"]["outfit"]["SHOES"]
        assert ctx["shoes"] == won, (seed, won, ctx["shoes"])


def test_accepts_to_accepts_axes_agree_under_a_diagonal():
    # A: with the target also accepts, its own axis roll is restricted to the
    # constraint-allowed tag, so $outfit.SHOES == $shoes.SHOES on every run.
    for seed in range(12):
        ctx = PipelineEngine().run(
            [_src_accepts(), _diagonal(), _target("accepts")], seed=seed)
        s = ctx["__wp_axes__"]["outfit"]["SHOES"]
        t = ctx["__wp_axes__"]["shoes"]["SHOES"]
        assert s == t, (seed, s, t)


def _target_multitag_accepts():
    # A single target option carrying TWO accepts-axis tags — the shape the
    # symmetric target OR-fold exists for.
    return {"type": "wildcard", "id": "tgt00001", "_uid": "tgt00001",
            "payload": {
                "var_binding": "shoes",
                "sub_categories": _SHOES,
                "tag_groups": {"SHOES": _SHOES},
                "tag_group_kinds": {"SHOES": "accepts"},
                "options": [{"id": "combo", "value": "combo", "weight": 1,
                             "sub_categories": ["sandals", "heels"]}],
            },
            "instance": {"variable_binding": "shoes"}}


def test_target_accepts_multitag_option_survives_and_rolls_the_matched_tag():
    # Symmetric target OR-fold: a target accepts option tagged {sandals, heels}
    # is viable whenever the source allows EITHER (not excluded because it also
    # carries an excluded sibling), and A then pins its roll to the allowed one.
    seen = set()
    for seed in range(24):
        ctx = PipelineEngine().run(
            [_src_accepts(), _diagonal(), _target_multitag_accepts()], seed=seed)
        src = ctx["__wp_axes__"]["outfit"]["SHOES"]
        # The option only offers sandals/heels; it survives iff the source rolled
        # one of those (here the source menu is sneakers/sandals, so only sandals
        # lets it through). Never an empty pool when source rolled sandals.
        if src == "sandals":
            assert ctx["shoes"] == "combo", (seed, src, ctx["shoes"])
            assert ctx["__wp_axes__"]["shoes"]["SHOES"] == "sandals", (seed,)
            seen.add("matched")
    assert "matched" in seen
