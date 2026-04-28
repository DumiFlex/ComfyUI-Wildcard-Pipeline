"""Verify the pipeline rewire: ctx.rng + ctx.warnings + dispatcher routing."""
from __future__ import annotations

import random

from engine.modules import Module
from engine.pipeline import PipelineEngine


def _module(type_id: str, **kwargs) -> Module:
    return Module(id="m1", type=type_id, payload=kwargs.get("payload", {}),
                  enabled=kwargs.get("enabled", True))


def test_pipeline_initializes_rng_from_seed():
    eng = PipelineEngine()
    ctx = eng.run([], ctx={}, seed=42)
    assert "__wp_rng__" in ctx
    assert isinstance(ctx["__wp_rng__"], random.Random)


def test_pipeline_initializes_warnings_list():
    eng = PipelineEngine()
    ctx = eng.run([], ctx={}, seed=0)
    assert ctx["__wp_warnings__"] == []


def test_pipeline_unknown_module_type_logs_skipped():
    """Unknown types log a warning + skip, don't crash."""
    eng = PipelineEngine()

    class _FakeModule:
        id = "m1"
        type = "not_a_real_type"
        enabled = True

    ctx = eng.run([_FakeModule()], ctx={}, seed=0)  # type: ignore[list-item]
    # Trace should record the skip
    trace = ctx.get("__wp_trace__", [])
    assert len(trace) == 1
    assert trace[0].get("status") == "skipped_unknown_type"


def test_pipeline_disabled_module_skipped():
    from engine.modules import FixedValueModule

    eng = PipelineEngine()
    mod = FixedValueModule(id="m1", enabled=False)
    ctx = eng.run([mod], ctx={}, seed=0)
    trace = ctx.get("__wp_trace__", [])
    assert len(trace) == 1
    assert trace[0].get("status") == "skipped_disabled"
