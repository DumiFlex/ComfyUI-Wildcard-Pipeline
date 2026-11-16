"""Determinism guard for performance work.

Runs the synthetic pipeline (``tests/perf/synthetic.py``) through the real
node entry points: one WP Context, a two-node chain, and a WP Context Loop
with held picks feeding a Context and an Assembler. Every output that a user
can see or that later nodes read (variables, negatives, picks, warnings,
assembled prompts) goes into a digest per case, and the digests must equal
the committed ones in ``tests/fixtures/determinism-golden.json``.

A speed-up must never change a pick, so this test must stay green through any
caching, indexing or copy-avoidance change. When a change is MEANT to alter
outputs, regenerate it on purpose:

    WP_WRITE_DETERMINISM_GOLDEN=1 pytest tests/test_determinism_golden.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pytest

from tests.perf.synthetic import build, with_holds
from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext

GOLDEN = Path(__file__).parent / "fixtures" / "determinism-golden.json"
SEEDS = (0, 1, 7, 42, 1234, 99991)
NEGATIVE_TEMPLATE = "$negatives, lowres"


def _out(result: Any) -> tuple:
    """Positional outputs of a node result (stub and real ``NodeOutput``)."""
    args = getattr(result, "args", None)
    return tuple(args) if args is not None else tuple(result)


def _public(d: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in sorted(d.items()) if not str(k).startswith("__")}


def _observable(payload: Any, template: str) -> dict[str, Any]:
    """Everything downstream can read off one Context payload."""
    internals = payload.internals or {}
    prompt, negative = _out(WPPromptAssembler.execute(payload, template, NEGATIVE_TEMPLATE))[:2]
    return {
        "vars": _public(payload.context or {}),
        "negatives": internals.get("__wp_negatives__"),
        "picks": internals.get("__wp_picks__"),
        "hits": internals.get("__wp_constraint_hits__"),
        "warnings": sorted(
            json.dumps(w, sort_keys=True, default=str)
            for w in (payload.debug or {}).get("warnings", []) or []
        ),
        "prompt": prompt,
        "negative": negative,
    }


def _digest(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory):
    syn = build("test")
    db = tmp_path_factory.mktemp("golden") / "wp.db"
    syn.write_db(db)
    return syn, db


@pytest.fixture(scope="module")
def library(synthetic):
    syn, db = synthetic
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("WP_DB_PATH", str(db))
        yield syn


@pytest.fixture(scope="module")
def first_run(library):
    return _compute(library)


def _compute(syn) -> dict[str, Any]:
    template = syn.template()
    # The node gets only the modules (the catalog of the leaf wildcards comes
    # from the live library), exactly like a saved workflow.
    widget = json.dumps({"modules": syn.modules})
    half = len(syn.modules) // 2
    widget_a = json.dumps({"modules": syn.modules[:half]})
    widget_b = json.dumps({"modules": syn.modules[half:]})
    held = json.dumps({"modules": with_holds(syn.modules, ("w0", "w3", "w7"))})
    cases: dict[str, Any] = {}
    samples: dict[str, Any] = {}

    for seed in SEEDS:
        single = _out(WPContext.execute(seed=seed, wp_modules=widget))[0]
        obs = _observable(single, template)
        cases[f"single/{seed}"] = _digest(obs)
        if seed == SEEDS[0]:
            samples["single"] = {"prompt": obs["prompt"], "negative": obs["negative"]}

        a = _out(WPContext.execute(seed=seed, wp_modules=widget_a))[0]
        b = _out(WPContext.execute(seed=seed + 1, wp_modules=widget_b, upstream=a))[0]
        cases[f"chain/{seed}"] = _digest(_observable(b, template))

    cfg = json.dumps({"override_seed": True, "strategy": "hash_index"})
    for seed in SEEDS[:3]:
        loop = WPContextLoop.execute(seed=[seed], count=[6], wp_context_loop_config=[cfg])
        frames = _out(loop)[0]
        per_frame = []
        for fp in frames:
            out = _out(WPContext.execute(seed=seed, wp_modules=held, upstream=fp))[0]
            per_frame.append(_observable(out, template))
        cases[f"loop_hold/{seed}"] = _digest(per_frame)
        if seed == SEEDS[0]:
            samples["loop_hold_frame1"] = {"prompt": per_frame[1]["prompt"]}
    return {"cases": cases, "samples": samples}


def test_synthetic_modules_are_engine_valid():
    """The generator must produce payloads the engine accepts, or the golden
    would only cover the error path."""
    from engine.modules.dispatcher import get_handler

    syn = build("test")
    for m in syn.modules:
        handler = get_handler(m["type"])
        assert handler is not None, m["type"]
        handler.validate_payload(m["payload"])
    for _name, payload in syn.wildcards.values():
        get_handler("wildcard").validate_payload(payload)


def test_outputs_match_golden(first_run):
    got = first_run
    if os.environ.get("WP_WRITE_DETERMINISM_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(got, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                          encoding="utf-8")
        pytest.skip("golden rewritten")
    assert GOLDEN.exists(), "run with WP_WRITE_DETERMINISM_GOLDEN=1 to create the golden file"
    want = json.loads(GOLDEN.read_text(encoding="utf-8"))
    # Samples first: a readable diff when something moved.
    assert got["samples"] == want["samples"]
    assert got["cases"] == want["cases"]


def test_outputs_are_stable_within_a_process(library, first_run):
    """Same inputs twice in one process give the same outputs, so no cache
    added later may leak state between runs."""
    assert _compute(library) == first_run
