"""Test resolve_text core dispatch loop and per-kind resolution."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from engine.syntax import resolve_text
from engine.syntax.types import SurfaceKind


@dataclass
class _FakeCtx:
    """Test double matching the ResolveContext Protocol."""
    rng: random.Random = field(default_factory=lambda: random.Random(42))
    max_ref_depth: int = 8
    strict: bool = False
    surface: SurfaceKind = "wildcard"
    developer_mode: bool = False
    warnings: list[dict[str, Any]] = field(default_factory=list)
    _vars: dict[str, str] = field(default_factory=dict)
    _modules: dict[str, dict[str, Any]] = field(default_factory=dict)

    def get_var(self, name: str) -> str | None:
        return self._vars.get(name)

    def get_module(self, uuid: str) -> dict[str, Any] | None:
        return self._modules.get(uuid)


def _ctx(**kwargs) -> _FakeCtx:
    return _FakeCtx(**kwargs)


def test_resolve_empty_string():
    assert resolve_text("", _ctx()) == ""


def test_resolve_plain_text():
    assert resolve_text("hello world", _ctx()) == "hello world"


def test_resolve_escape_dollar():
    assert resolve_text("price: $$5", _ctx()) == "price: $5"


def test_resolve_escape_at():
    assert resolve_text("user@@example", _ctx()) == "user@example"


def test_resolve_var_present():
    ctx = _ctx(_vars={"color": "red"})
    assert resolve_text("$color thing", ctx) == "red thing"


def test_resolve_var_missing_lenient_emits_empty():
    ctx = _ctx(strict=False)
    assert resolve_text("$missing thing", ctx) == " thing"
    # Note: whitespace cleanup is the caller's responsibility (engine/template.py
    # adds a thin pass). The raw resolver output is what we test here.


def test_resolve_var_skips_internal_keys():
    """$__name__ pattern is engine-internal and should never resolve via ctx."""
    ctx = _ctx(_vars={"__wp_node_seed__": "42"})
    # Tokenizer recognizes $__wp_node_seed__ as a var, but resolver checks
    # if name starts with __ and refuses.
    assert resolve_text("$__wp_node_seed__", ctx) == ""
