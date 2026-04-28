"""Tests for catalog injection at WP_Context node execution + the
backwards-compat path for old workflow JSON. Spec §4.4 / §6 / 5.5.3."""
from __future__ import annotations

from wp_nodes.types import deserialize_node_input


def test_deserialize_returns_modules_with_empty_snapshots_for_legacy_input():
    """Old workflow JSON had only `modules` (a list). The deserializer
    returns `(modules, snapshots, pickOrder)` where snapshots defaults to
    empty dict and pickOrder defaults to empty list — backwards compat,
    spec §4.5."""
    legacy = {"modules": [
        {"type": "fixed_values", "name": "x", "payload": {"values": []}},
    ]}
    modules, snapshots, pick_order = deserialize_node_input(legacy)
    assert len(modules) == 1
    assert snapshots == {}
    assert pick_order == []


def test_deserialize_extracts_snapshots_and_pickorder_from_new_input():
    new_shape = {
        "modules": [
            {"type": "wildcard", "name": "outfit",
             "payload": {"options": [{"value": "x"}]}},
        ],
        "snapshots": {
            "ou111111": {
                "snapshot_version": 1, "uuid": "ou111111", "type": "wildcard",
                "name": "outfit",
                "payload": {"options": [{"value": "x"}]},
                "payload_hash": "h" * 64,
                "source": {"kind": "user"},
            },
        },
        "pickOrder": ["ou111111"],
        "snapshotVersion": 1,
    }
    modules, snapshots, pick_order = deserialize_node_input(new_shape)
    assert len(modules) == 1
    assert "ou111111" in snapshots
    assert pick_order == ["ou111111"]


def _ctx_capture():
    """Spy that captures the ctx dict passed to PipelineEngine.run()."""
    captured: dict = {}

    class _FakePipeline:
        def run(self, modules, *, ctx, seed):
            captured.clear()
            captured.update(ctx)
            return ctx
    return _FakePipeline, captured


def test_execute_injects_catalog_from_snapshots_field(monkeypatch):
    """Snapshots from the input become ctx['__wp_catalog__'] exactly once
    at the top of execute. Spec §2.6."""
    from wp_nodes import context_node as cn

    fake_cls, captured = _ctx_capture()
    monkeypatch.setattr(cn, "PipelineEngine", fake_cls)

    snapshots = {
        "ou111111": {"snapshot_version": 1, "uuid": "ou111111",
                     "type": "wildcard", "name": "outfit",
                     "payload": {"options": []}, "payload_hash": "h" * 64,
                     "source": {"kind": "user"}},
    }
    cn.WPContext.execute(
        seed=42,
        modules={"modules": [], "snapshots": snapshots, "pickOrder": ["ou111111"]},
        upstream=None,
    )
    assert captured["__wp_catalog__"] == snapshots


def test_execute_defaults_to_empty_catalog_for_old_workflow_json(monkeypatch):
    """Old JSON without `snapshots` field — catalog stays {} so resolver
    emits "Unknown ref" warning rather than crashing. Spec §4.5."""
    from wp_nodes import context_node as cn

    fake_cls, captured = _ctx_capture()
    monkeypatch.setattr(cn, "PipelineEngine", fake_cls)

    cn.WPContext.execute(
        seed=0,
        modules={"modules": []},  # no snapshots
        upstream=None,
    )
    assert captured["__wp_catalog__"] == {}
