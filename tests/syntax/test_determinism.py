"""Cross-language byte-equality + determinism property tests.

The cross-language byte-equality is INTENTIONALLY OMITTED — Python uses
Mersenne Twister (random.Random), TS uses mulberry32. They cannot produce
byte-identical output for randomness-bearing cases. Both languages
independently verify against `expected_resolution.output` for deterministic
cases.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.syntax import resolve_text
from engine.syntax.types import SurfaceKind

CORPUS_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "syntax-corpus.json"


@dataclass
class _DetCtx:
    rng: random.Random = field(default_factory=lambda: random.Random(42))
    max_ref_depth: int = 8
    strict: bool = False
    surface: SurfaceKind = "wildcard"
    developer_mode: bool = False
    warnings: list = field(default_factory=list)
    _vars: dict[str, str] = field(default_factory=dict)
    _modules: dict[str, dict] = field(default_factory=dict)

    def get_var(self, name: str) -> str | None:
        return self._vars.get(name)

    def get_module(self, uuid: str) -> dict[str, Any] | None:
        return self._modules.get(uuid)


def _load_cases() -> list[dict]:
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))["cases"]


def _ctx_from_case(case: dict) -> _DetCtx:
    """Build a _DetCtx from a corpus case's expected_resolution config."""
    er = case["expected_resolution"]
    catalog = er.get("catalog", []) or []
    # Catalog can be a list of module dicts (each having `uuid`) or already a uuid-keyed dict.
    if isinstance(catalog, list):
        modules = {m["uuid"]: m for m in catalog if "uuid" in m}
    else:
        modules = catalog
    return _DetCtx(
        rng=random.Random(er.get("seed", 42)),
        max_ref_depth=er.get("max_ref_depth", 8),
        strict=er.get("strict", False),
        surface=er.get("surface", "wildcard"),
        _vars=dict(er.get("ctx_vars", {})),
        _modules=modules,
    )


def test_resolve_corpus_cases_match_expected():
    """Python resolver output matches each corpus case's expected_resolution.output."""
    cases = _load_cases()
    for c in cases:
        if "expected_resolution" not in c:
            continue
        ctx = _ctx_from_case(c)
        out = resolve_text(c["input"], ctx)
        assert out == c["expected_resolution"]["output"], (
            f"resolve_text mismatch for case {c['name']}: "
            f"got {out!r}, expected {c['expected_resolution']['output']!r}"
        )


def test_resolve_text_deterministic_1000():
    """Same seed + same input → all 1000 outputs identical."""
    template = "{a|b|c|d|e}"
    outputs = set()
    for _ in range(1000):
        ctx = _DetCtx(rng=random.Random(42))
        outputs.add(resolve_text(template, ctx))
    assert len(outputs) == 1, f"non-deterministic: {outputs}"


def test_rng_state_progression():
    """Two ctx with same seed must consume RNG identically through resolution.
    Catches token-order RNG-consumption bugs (e.g. iterating dicts unordered)."""
    template = "$x {a|b} $y {1$$, $$1|2|3}"
    ctx1 = _DetCtx(rng=random.Random(42), _vars={"x": "X", "y": "Y"})
    ctx2 = _DetCtx(rng=random.Random(42), _vars={"x": "X", "y": "Y"})
    resolve_text(template, ctx1)
    resolve_text(template, ctx2)
    # Post-resolution, both RNGs must be at the exact same internal state.
    assert ctx1.rng.random() == ctx2.rng.random()
    seq1 = [ctx1.rng.random() for _ in range(100)]
    seq2 = [ctx2.rng.random() for _ in range(100)]
    assert seq1 == seq2
