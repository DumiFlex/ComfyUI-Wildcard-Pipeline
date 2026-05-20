"""Bundle.enabled is a non-destructive gate, not a mutator.

Previously the SPA cascaded `BundleInstance.enabled` into every child's
`module.enabled` on toggle. Disabling a bundle clobbered each child's
individual on/off state; re-enabling restored them all to `true`,
regardless of who was actually off before. Users couldn't keep a
"4 disabled, 3 enabled" composition through a bundle-level toggle.

Now `child.instance.enabled` is preserved verbatim. The engine sees the
effective view via `deserialize_node_input`, which ANDs each bundle's
enabled flag with its children's at the wire boundary. Bundle gate flips
purely cosmetically on the workflow state; the engine reads the gated
shape.

Effective enabled = bundle.enabled AND child.enabled.
"""
from __future__ import annotations

from wp_nodes.types import deserialize_node_input


def _wildcard(mid: str, *, enabled: bool, bundle_origin: str | None = None) -> dict:
    row: dict = {
        "id": mid,
        "_uid": f"u-{mid}",
        "type": "wildcard",
        "enabled": enabled,
        "meta": {"name": mid},
        "entries": [],
        "payload": {"options": [{"id": "o", "value": "x", "weight": 1}]},
    }
    if bundle_origin is not None:
        row["bundle_origin"] = bundle_origin
    return row


def test_no_bundles_returns_modules_verbatim():
    """Without a `bundles[]` field, the gate is a no-op."""
    raw = {"modules": [_wildcard("m1", enabled=True), _wildcard("m2", enabled=False)]}
    modules, _, _ = deserialize_node_input(raw)
    assert [m["enabled"] for m in modules] == [True, False]


def test_disabled_bundle_gates_its_children_only():
    """A disabled bundle masks `enabled=False` onto every child whose
    `bundle_origin` matches. Children outside the bundle are untouched."""
    raw = {
        "bundles": [{"_uid": "B1", "enabled": False, "start_idx": 0, "end_idx": 1}],
        "modules": [
            _wildcard("m1", enabled=True, bundle_origin="B1"),
            _wildcard("m2", enabled=True, bundle_origin="B1"),
            _wildcard("m3", enabled=True),  # outside bundle
        ],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert [m["enabled"] for m in modules] == [False, False, True]


def test_enabled_bundle_passes_children_through_unchanged():
    """When `bundle.enabled` is true, the gate is a no-op for that
    bundle's children — they keep their individual on/off."""
    raw = {
        "bundles": [{"_uid": "B1", "enabled": True, "start_idx": 0, "end_idx": 1}],
        "modules": [
            _wildcard("m1", enabled=True, bundle_origin="B1"),
            _wildcard("m2", enabled=False, bundle_origin="B1"),
        ],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert [m["enabled"] for m in modules] == [True, False]


def test_gate_preserves_individual_state_on_the_original_row():
    """The gate must clone the row rather than mutate. The SPA holds onto
    the same dict for undo + state restore; mutating it here would mean
    re-enabling the bundle no longer restores the child's previous state."""
    child = _wildcard("m1", enabled=True, bundle_origin="B1")
    raw = {
        "bundles": [{"_uid": "B1", "enabled": False, "start_idx": 0, "end_idx": 0}],
        "modules": [child],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert modules[0]["enabled"] is False  # engine-facing view
    assert child["enabled"] is True  # original row preserved


def test_gate_skips_orphan_bundle_origin():
    """If `bundle_origin` points at a bundle uid that isn't in the
    `bundles[]` list (stale / removed), the row passes through with its
    own enabled flag intact rather than being gated to false."""
    raw = {
        "bundles": [{"_uid": "B1", "enabled": False, "start_idx": 0, "end_idx": 0}],
        "modules": [
            _wildcard("m1", enabled=True, bundle_origin="STALE"),
        ],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert modules[0]["enabled"] is True


def test_gate_handles_missing_bundle_origin():
    """Top-level (non-bundle) modules have no `bundle_origin` — the gate
    leaves them strictly untouched even when other bundles are disabled."""
    raw = {
        "bundles": [{"_uid": "B1", "enabled": False, "start_idx": 0, "end_idx": 0}],
        "modules": [
            _wildcard("m1", enabled=True, bundle_origin="B1"),
            _wildcard("m2", enabled=True),
        ],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert [m["enabled"] for m in modules] == [False, True]


# ── Tier-2 nesting: parent_uid chain ──────────────────────────────────────


def test_gate_ands_through_parent_chain_disabled_outer():
    """An inner bundle (parent_uid → outer) inherits the outer's
    disabled state. The leaf's bundle_origin points at the INNER, but
    the gate walks parent_uid up and ANDs through the chain — disabled
    outer disables every leaf in every inner."""
    raw = {
        "bundles": [
            {"_uid": "OUTER", "enabled": False, "start_idx": 0, "end_idx": 0},
            {"_uid": "INNER", "enabled": True, "parent_uid": "OUTER",
             "start_idx": 0, "end_idx": 0},
        ],
        "modules": [_wildcard("m1", enabled=True, bundle_origin="INNER")],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert modules[0]["enabled"] is False


def test_gate_allows_when_both_inner_and_outer_enabled():
    raw = {
        "bundles": [
            {"_uid": "OUTER", "enabled": True, "start_idx": 0, "end_idx": 0},
            {"_uid": "INNER", "enabled": True, "parent_uid": "OUTER",
             "start_idx": 0, "end_idx": 0},
        ],
        "modules": [_wildcard("m1", enabled=True, bundle_origin="INNER")],
    }
    modules, _, _ = deserialize_node_input(raw)
    assert modules[0]["enabled"] is True


def test_gate_disables_when_only_inner_is_off():
    """Outer enabled, inner disabled — inner-leaf disabled."""
    raw = {
        "bundles": [
            {"_uid": "OUTER", "enabled": True, "start_idx": 0, "end_idx": 1},
            {"_uid": "INNER", "enabled": False, "parent_uid": "OUTER",
             "start_idx": 0, "end_idx": 0},
        ],
        "modules": [
            _wildcard("inner_leaf", enabled=True, bundle_origin="INNER"),
            _wildcard("outer_leaf", enabled=True, bundle_origin="OUTER"),
        ],
    }
    modules, _, _ = deserialize_node_input(raw)
    # Inner-leaf gated off; outer-direct leaf still on.
    assert [m["enabled"] for m in modules] == [False, True]


def test_gate_walk_terminates_on_cycle():
    """Defensive depth cap — a corrupt cycle in parent_uid must not
    spin forever. Gate falls through with the leaf's own enabled."""
    raw = {
        "bundles": [
            {"_uid": "A", "enabled": True, "parent_uid": "B",
             "start_idx": 0, "end_idx": 0},
            {"_uid": "B", "enabled": True, "parent_uid": "A",
             "start_idx": 0, "end_idx": 0},
        ],
        "modules": [_wildcard("m1", enabled=True, bundle_origin="A")],
    }
    # Should NOT raise; just return the row as-is (or gated off if
    # any ancestor in the partial walk was disabled — both A and B
    # are enabled here, so the result is True).
    modules, _, _ = deserialize_node_input(raw)
    assert modules[0]["enabled"] is True
