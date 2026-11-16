"""WP_Context reuses the hold base pass across the frames of a Context Loop.

Frames 1..N-1 each ran the whole chain once more on frame 0's inputs. The
first result is now kept (keyed on the widget, the catalog's walk, the hold
seed, the depth setting and frame 0's inputs) and handed to the rest as fresh
objects. Outputs must be identical with and without it.
"""
from __future__ import annotations

import json

import pytest

import wp_nodes.context_node as context_node
from engine.pipeline import HOLD_BASE_MEMO_KEY, PipelineEngine
from tests.perf.synthetic import build, with_holds
from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_loop import WPContextLoop

CFG = json.dumps({"override_seed": True, "strategy": "hash_index"})


@pytest.fixture
def library(tmp_path, monkeypatch):
    syn = build("test")
    db = tmp_path / "wp.db"
    syn.write_db(db)
    monkeypatch.setenv("WP_DB_PATH", str(db))
    monkeypatch.setattr(context_node, "_CATALOG_CACHE", type(context_node._CATALOG_CACHE)())
    monkeypatch.setattr(context_node, "_BASE_CACHE", type(context_node._BASE_CACHE)())
    return syn


def _frames(syn, seed=3, count=5):
    held = json.dumps({"modules": with_holds(syn.modules, ("w0", "w3", "w7"))})
    frames = WPContextLoop.execute(seed=[seed], count=[count], wp_context_loop_config=[CFG]).args[0]
    out = []
    for fp in frames:
        p = context_node.WPContext.execute(seed=seed, wp_modules=held, upstream=fp).args[0]
        prompt = WPPromptAssembler.execute(p, syn.template(), "$negatives").args
        out.append({
            "context": {k: str(v) for k, v in p.context.items()},
            "internals": json.dumps(p.internals, sort_keys=True, default=str),
            "debug": json.dumps(p.debug, sort_keys=True, default=str),
            "prompt": list(prompt),
        })
    return out


def _count_runs(monkeypatch):
    runs = []
    real = PipelineEngine.run

    def counting(self, modules, ctx=None, seed=0, hold_seed=None, loop_index=0):
        runs.append(loop_index)
        return real(self, modules, ctx=ctx, seed=seed, hold_seed=hold_seed, loop_index=loop_index)

    monkeypatch.setattr(PipelineEngine, "run", counting)
    return runs


def test_frames_match_without_the_memo(library, monkeypatch):
    with_memo = _frames(library)
    assert len(context_node._BASE_CACHE) == 1
    monkeypatch.setattr(context_node, "_hold_base_key", lambda *a, **k: None)
    monkeypatch.setattr(context_node, "_BASE_CACHE", type(context_node._BASE_CACHE)())
    assert _frames(library) == with_memo


def test_the_base_pass_runs_once_per_queue(library, monkeypatch):
    runs = _count_runs(monkeypatch)
    _frames(library, count=5)
    # 5 frame passes + ONE base pass (frame 1), not one per frame 1..4.
    assert sorted(runs) == [0, 0, 1, 2, 3, 4]


def test_a_library_edit_mid_queue_reruns_the_base_pass(library, monkeypatch):
    from engine.db.connection import get_connection
    from engine.db.repositories import ModuleRepository

    _frames(library, count=3)
    leaf = library.leaf_ids[0]
    conn = get_connection()
    try:
        repo = ModuleRepository(conn)
        payload = repo.get(leaf)["payload"]
        payload["options"][0]["value"] = "edited leaf option"
        repo.update(leaf, payload=payload)
    finally:
        conn.close()
    runs = _count_runs(monkeypatch)
    _frames(library, count=3)
    assert sorted(runs) == [0, 0, 1, 2]


def test_another_seed_misses(library):
    _frames(library, seed=3, count=3)
    _frames(library, seed=4, count=3)
    assert len(context_node._BASE_CACHE) == 2


def test_memo_key_never_reaches_the_output(library):
    held = json.dumps({"modules": with_holds(library.modules, ("w0",))})
    frames = WPContextLoop.execute(seed=[1], count=[3], wp_context_loop_config=[CFG]).args[0]
    for fp in frames:
        p = context_node.WPContext.execute(seed=1, wp_modules=held, upstream=fp).args[0]
        assert HOLD_BASE_MEMO_KEY not in p.internals
        assert HOLD_BASE_MEMO_KEY not in p.context


def test_handed_out_base_ctx_is_fresh(library):
    memo = context_node._HoldBaseMemo(("k",), catalog := {"x": {"payload": {}}})
    base = {"__wp_catalog__": catalog, "v": ["a"], "__wp_picks__": {"m": {"value": "a"}}}
    memo.put(base)
    assert base["__wp_catalog__"] is catalog
    one, two = memo.get(), memo.get()
    assert one == two == base
    assert one["__wp_catalog__"] is catalog
    one["v"].append("b")
    one["__wp_picks__"]["m"]["value"] = "z"
    assert memo.get() == base


def test_put_skips_a_foreign_catalog_and_unpicklable_ctx(library):
    memo = context_node._HoldBaseMemo(("k2",), {})
    memo.put({"__wp_catalog__": {"other": 1}})
    memo.put({"__wp_catalog__": memo._catalog, "bad": lambda: 1})
    assert memo.get() is None
    assert ("k2",) not in context_node._BASE_CACHE
