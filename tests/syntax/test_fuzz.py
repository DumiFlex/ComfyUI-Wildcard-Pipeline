"""Fuzz tests for engine syntax — 10k random inputs.

Goals:
  1. Tokenizer never crashes (any input is parseable).
  2. Tokenizer is lossless: "".join(t.raw for t in tokens) == input.
  3. Resolver never crashes on random input (lenient mode).

Fixed seed (0) for reproducibility — fuzz failures must reproduce.
Each iter uses fresh ctx for the resolver (RNG drift across iterations
would make output non-deterministic, breaking the fuzz contract).
"""
from __future__ import annotations

import random
import string
from dataclasses import dataclass, field

import pytest

from engine.syntax import resolve_text, tokenize_text
from engine.syntax.types import SurfaceKind


@dataclass
class _FuzzCtx:
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

    def get_module(self, uuid: str) -> dict | None:
        return self._modules.get(uuid)


def _wc(uuid: str, var_binding: str) -> dict:
    return {
        "type": "wildcard",
        "var_binding": var_binding,
        "options": [{"value": "leaf", "weight": 1}],
    }


def _random_input(rng: random.Random, max_len: int = 200) -> str:
    """Generate input mixing literal text + valid + malformed syntax fragments."""
    alphabet = string.ascii_letters + string.digits + " ${}@|*#$, \n\t"
    return "".join(rng.choices(alphabet, k=rng.randint(0, max_len)))


@pytest.mark.fuzz
def test_tokenize_does_not_crash():
    rng = random.Random(0)  # deterministic seed → reproducible failures
    for i in range(10_000):
        s = _random_input(rng)
        try:
            tokens = tokenize_text(s)
        except Exception as e:
            pytest.fail(f"tokenize_text crashed on {s!r} (iter {i}): {e!r}")
        # Tokenizer is lossless: concatenated raws == input
        joined = "".join(t.raw for t in tokens)
        assert joined == s, (
            f"lossless invariant broken on {s!r} (iter {i}): got {joined!r}"
        )


@pytest.mark.fuzz
def test_resolve_does_not_crash():
    """Resolver in lenient mode must never raise on random input.

    Each iter gets fresh ctx so RNG state doesn't drift across iterations.
    """
    from engine.syntax.types import SyntaxError as EngineSyntaxError

    rng = random.Random(0)
    catalog = {f"u{i:08x}": _wc(f"u{i:08x}", f"v{i}") for i in range(8)}
    for i in range(10_000):
        s = _random_input(rng)
        ctx = _FuzzCtx(
            rng=random.Random(42),  # FRESH per iter
            strict=False,
            _modules=catalog,
        )
        try:
            resolve_text(s, ctx)
        except EngineSyntaxError:
            pass  # known engine errors are fine
        except Exception as e:
            pytest.fail(f"resolve_text crashed on {s!r} (iter {i}): {e!r}")
