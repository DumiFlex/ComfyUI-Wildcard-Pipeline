"""Per-queue engine budgets on the heavy synthetic pipeline. Opt-in via -m perf.

`tests/perf/synthetic.py` ``build("bench")``: 45 modules, ~4.4k top-level
options, nested ``@{uuid}`` refs into 10 library-only wildcards, 10
constraints with exceptions, derivations, combines, negatives. All wildcards
live in a scratch library DB, so WP Context's live-library walk runs as in
production.

Budgets are about 2x the numbers measured after the P2 engine work (CPU time
per call, best batch, GC off, desktop CPU, 2026-11-16; before -> after):

  PipelineEngine.run (explain on)         ~59 ms -> ~35 ms    budget 80 ms
  WPContext.execute, warm (repeat queue)  ~310 ms -> ~60 ms   budget 130 ms
  WPContext.execute, cold (first run)     ~310 ms -> ~130 ms  budget 260 ms
  Context Loop, 16 frames, 3 held         ~6.9 s -> ~1.0 s    budget 2.5 s
"""
from __future__ import annotations

import gc
import json
import time

import pytest

from engine.pipeline import PipelineEngine
from tests.perf.synthetic import build, with_holds

pytestmark = pytest.mark.perf

CFG = json.dumps({"override_seed": True, "strategy": "hash_index"})


@pytest.fixture(scope="module")
def bench(tmp_path_factory):
    syn = build("bench")
    db = tmp_path_factory.mktemp("perf") / "wp.db"
    syn.write_db(db)
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("WP_DB_PATH", str(db))
        yield syn


def _cpu_ms(fn, n: int, warm: int = 2, batches: int = 3) -> float:
    """CPU milliseconds per call, best of ``batches`` batches of ``n`` calls.

    CPU time (``process_time``) rather than wall time, so a busy machine does
    not fail the budget; batched because Windows ticks it at 15.6 ms.
    """
    for i in range(warm):
        fn(10_000 + i)
    per_call = []
    k = 0
    gc.collect()
    gc.disable()
    try:
        for _ in range(batches):
            t0 = time.process_time()
            for _ in range(n):
                fn(k)
                k += 1
            per_call.append((time.process_time() - t0) * 1000 / n)
    finally:
        gc.enable()
    return min(per_call)


def test_engine_run_under_budget(bench):
    catalog = bench.catalog()

    def run(i):
        ctx = {"__wp_catalog__": catalog, "__wp_explain__": True, "__wp_ref_log__": []}
        PipelineEngine().run(bench.modules, ctx=ctx, seed=1000 + i)

    ms = _cpu_ms(run, 10)
    assert ms < 80, f"PipelineEngine.run took {ms:.1f} ms"


def test_context_execute_warm_under_budget(bench):
    from wp_nodes.context_node import WPContext

    widget = json.dumps({"modules": bench.modules})
    ms = _cpu_ms(lambda i: WPContext.execute(seed=i, wp_modules=widget), 6)
    assert ms < 130, f"WPContext.execute (warm) took {ms:.1f} ms"


def test_context_execute_cold_under_budget(bench):
    import wp_nodes.context_node as context_node

    widget = json.dumps({"modules": bench.modules})

    def cold(i):
        # Nothing cached: every call walks the library again.
        context_node._CATALOG_CACHE.clear()
        context_node.WPContext.execute(seed=i, wp_modules=widget)

    ms = _cpu_ms(cold, 4)
    assert ms < 260, f"WPContext.execute (cold) took {ms:.1f} ms"


def test_context_loop_16_frames_under_budget(bench):
    from wp_nodes.assembler_node import WPPromptAssembler
    from wp_nodes.context_loop import WPContextLoop
    from wp_nodes.context_node import WPContext

    held = json.dumps({"modules": with_holds(bench.modules, ("w0", "w5", "w9"))})
    template = bench.template()

    def queue(i):
        frames = WPContextLoop.execute(seed=[i], count=[16], wp_context_loop_config=[CFG]).args[0]
        for fp in frames:
            out = WPContext.execute(seed=i, wp_modules=held, upstream=fp).args[0]
            WPPromptAssembler.execute(out, template, "$negatives")

    ms = _cpu_ms(queue, 1, warm=1)
    assert ms < 2500, f"16-frame Context Loop queue took {ms:.0f} ms"
