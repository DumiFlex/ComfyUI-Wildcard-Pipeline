"""A run never writes to `ctx["__wp_catalog__"]`.

The hold base pass shares the catalog with the frame's own pass instead of
deep-copying it, and WP_Context reuses one expanded catalog across frames and
queues, so both rely on runs treating the catalog (entries and payloads) as
read-only. Covers nested refs, nested-ref constraint targets, holds and the
frame-0 base pass.
"""
from __future__ import annotations

import copy

from engine.pipeline import FRAME0_CTX_KEY, PipelineEngine
from tests.perf.synthetic import build, with_holds


def test_runs_leave_the_catalog_untouched():
    syn = build("test")
    catalog = syn.catalog()
    before = copy.deepcopy(catalog)
    held = with_holds(syn.modules, ("w0", "w3", "w7"))
    for seed in (0, 1, 7):
        ctx = {"__wp_catalog__": catalog, "__wp_explain__": True, "__wp_ref_log__": []}
        PipelineEngine().run(syn.modules, ctx=ctx, seed=seed)
        for loop_index in (1, 2):
            frame0 = {"__wp_catalog__": catalog, "__wp_explain__": True,
                      "__wp_ref_log__": [], "iteration": "1"}
            ctx = {"__wp_catalog__": catalog, "__wp_explain__": True, "__wp_ref_log__": [],
                   "iteration": str(loop_index + 1), FRAME0_CTX_KEY: frame0}
            out = PipelineEngine().run(held, ctx=ctx, seed=seed + loop_index,
                                       hold_seed=seed, loop_index=loop_index)
            assert isinstance(out.get("__wp_hold_base_ctx__"), dict)
            # The base pass shares the catalog object rather than a copy.
            assert out["__wp_hold_base_ctx__"]["__wp_catalog__"] is catalog
    assert catalog == before
