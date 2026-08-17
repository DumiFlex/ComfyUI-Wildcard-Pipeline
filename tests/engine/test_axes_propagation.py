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
