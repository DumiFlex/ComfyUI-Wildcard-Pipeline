"""Surface gating for $var token.

Combine, derivation, and assembler surfaces support $var reads.
Wildcard and fixed_values surfaces are binding PRODUCERS, not consumers
— $var reads in those surfaces warn + render literal in lenient mode,
raise VarOutOfSurfaceError in strict mode.
"""
import random

import pytest

from engine.syntax import resolve_text
from engine.syntax.types import VarOutOfSurfaceError


class _FakeCtx:
    """Minimal ResolveContext-shaped object for surface gating tests."""

    def __init__(self, surface, strict=False, vars_=None):
        self.surface = surface
        self.strict = strict
        self.developer_mode = False
        self.max_ref_depth = 8
        self.warnings = []
        self._vars = vars_ or {}
        self.rng = random.Random(0)

    def get_var(self, name):
        return self._vars.get(name)

    def get_module(self, uuid):
        return None


def test_var_resolves_on_combine_surface():
    ctx = _FakeCtx("combine", vars_={"name": "world"})
    assert resolve_text("hello $name", ctx) == "hello world"


def test_var_resolves_on_derivation_surface():
    ctx = _FakeCtx("derivation", vars_={"name": "world"})
    assert resolve_text("hello $name", ctx) == "hello world"


def test_var_resolves_on_assembler_surface():
    ctx = _FakeCtx("assembler", vars_={"name": "world"})
    assert resolve_text("hello $name", ctx) == "hello world"


def test_var_warns_on_wildcard_surface_lenient():
    """Wildcard surface: lenient strategy renders $name literal +
    pushes a var_out_of_surface warning."""
    ctx = _FakeCtx("wildcard", strict=False, vars_={"name": "world"})
    result = resolve_text("hello $name", ctx)
    assert result == "hello $name"
    assert any(w.get("type") == "var_out_of_surface" for w in ctx.warnings)


def test_var_warns_on_fixed_values_surface_lenient():
    ctx = _FakeCtx("fixed_values", strict=False, vars_={"name": "world"})
    result = resolve_text("hello $name", ctx)
    assert result == "hello $name"
    assert any(w.get("type") == "var_out_of_surface" for w in ctx.warnings)


def test_var_raises_on_wildcard_surface_strict():
    ctx = _FakeCtx("wildcard", strict=True)
    with pytest.raises(VarOutOfSurfaceError):
        resolve_text("hello $name", ctx)


def test_var_raises_on_fixed_values_surface_strict():
    ctx = _FakeCtx("fixed_values", strict=True)
    with pytest.raises(VarOutOfSurfaceError):
        resolve_text("hello $name", ctx)


def test_internal_dunder_var_never_warns():
    """__-prefixed vars are engine bookkeeping; never warn even on
    surfaces that disallow VAR."""
    ctx = _FakeCtx("wildcard", strict=False)
    result = resolve_text("$__wp_internal__", ctx)
    assert result == ""
    assert not any(w.get("type") == "var_out_of_surface" for w in ctx.warnings)
