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


def test_deserialize_synthesises_catalog_from_wildcard_modules():
    """Unified-list model: there is no separate `snapshots` field on
    the wire any more. The deserializer scans `modules`, picks every
    entry with `type == "wildcard"`, and synthesises a SnapshotEntry
    for it keyed by `id`. Pick-order is always empty under this model
    (the modules list itself preserves order)."""
    new_shape = {
        "modules": [
            {
                "id": "ou111111",
                "type": "wildcard",
                "enabled": True,
                "meta": {"name": "outfit"},
                "entries": [],
                "payload": {"options": [{"value": "x"}]},
                "payload_hash": "h" * 64,
            },
        ],
    }
    modules, catalog, pick_order = deserialize_node_input(new_shape)
    assert len(modules) == 1
    assert "ou111111" in catalog
    assert catalog["ou111111"]["payload"] == {"options": [{"value": "x"}]}
    assert catalog["ou111111"]["name"] == "outfit"
    assert pick_order == []


def _ctx_capture():
    """Spy that captures the ctx dict passed to PipelineEngine.run()."""
    captured: dict = {}

    class _FakePipeline:
        def run(self, modules, *, ctx, seed):
            captured.clear()
            captured.update(ctx)
            return ctx
    return _FakePipeline, captured


def test_execute_injects_catalog_synthesised_from_modules(monkeypatch):
    """Wildcard entries in `modules` become `ctx['__wp_catalog__']`
    keyed by id, exactly once at the top of execute. Spec §2.6 plus
    the unified-list change — no separate `snapshots` field on the
    wire any more."""
    from wp_nodes import context_node as cn

    fake_cls, captured = _ctx_capture()
    monkeypatch.setattr(cn, "PipelineEngine", fake_cls)

    cn.WPContext.execute(
        seed=42,
        modules={
            "modules": [
                {
                    "id": "ou111111",
                    "type": "wildcard",
                    "enabled": True,
                    "meta": {"name": "outfit"},
                    "entries": [],
                    "payload": {"options": [{"value": "x"}]},
                    "payload_hash": "h" * 64,
                },
            ],
        },
        upstream=None,
    )
    catalog = captured["__wp_catalog__"]
    assert "ou111111" in catalog
    assert catalog["ou111111"]["payload"] == {"options": [{"value": "x"}]}
    assert catalog["ou111111"]["name"] == "outfit"


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


def test_pipeline_trace_records_effective_seed_per_module():
    """The pipeline trace's `seed` field captures the seed each module
    actually rolled with — `instance.locked_seed` when locked, else
    the chain seed. Frontend reads this via the `module_seeds` UI
    payload to populate lock-toggle defaults authoritatively (works
    even when the seed input is link-driven)."""
    from engine.pipeline import PipelineEngine
    modules = [
        {
            "id": "m1",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "color"},
            "entries": [],
            "payload": {
                "var_binding": "color",
                "options": [{"id": "o1", "value": "red", "weight": 1}],
            },
            "instance": {"locked_seed": 99},
        },
        {
            "id": "m2",
            "type": "wildcard",
            "enabled": True,
            "meta": {"name": "shape"},
            "entries": [],
            "payload": {
                "var_binding": "shape",
                "options": [{"id": "o1", "value": "round", "weight": 1}],
            },
        },
    ]
    ctx = PipelineEngine().run(modules, seed=12345)
    trace = ctx["__wp_trace__"]
    assert trace[0]["seed"] == 99      # locked
    assert trace[1]["seed"] == 12345   # chain
