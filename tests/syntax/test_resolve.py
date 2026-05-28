"""Test resolve_text core dispatch loop and per-kind resolution."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

import pytest

from engine.syntax import resolve_text
from engine.syntax.types import SurfaceKind


@dataclass
class _FakeCtx:
    """Test double matching the ResolveContext Protocol.

    Default surface is "combine" because most tests in this module
    exercise VAR / DP_BRACE / ESCAPE resolution mechanics that combine
    surface allows. Wildcard surface (binding producer) does NOT
    support $var reads — those gating tests live in
    test_resolve_var_surface.py.
    """
    rng: random.Random = field(default_factory=lambda: random.Random(42))
    max_ref_depth: int = 8
    strict: bool = False
    surface: SurfaceKind = "combine"
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


# ---------------------------------------------------------------------------
# REF resolution tests (Task 9)
# ---------------------------------------------------------------------------


def _wc(uuid: str, var_binding: str, options=None) -> dict:
    """Build a wildcard module dict matching ctx.get_module's return shape."""
    if options is None:
        options = [{"value": "default", "weight": 1}]
    return {
        "type": "wildcard",
        "var_binding": var_binding,
        "options": options,
    }


def test_resolve_ref_in_wildcard_surface_picks_option():
    ctx = _ctx(
        surface="wildcard",
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "color", [{"value": "red", "weight": 1}])},
    )
    assert resolve_text("@{a4f7b2e1}", ctx) == "red"


def test_resolve_ref_unknown_uuid_lenient_emits_empty():
    # Use a valid 8-hex-char UUID that isn't in the catalog.
    ctx = _ctx(surface="wildcard", strict=False)
    assert resolve_text("a @{00000000} b", ctx) == "a  b"
    assert any(w["type"] == "unknown_ref" for w in ctx.warnings)


def test_resolve_ref_unknown_uuid_strict_raises():
    from engine.syntax import UnknownRefError
    # Use a valid 8-hex-char UUID that isn't in the catalog.
    ctx = _ctx(surface="wildcard", strict=True)
    with pytest.raises(UnknownRefError) as exc:
        resolve_text("@{00000000}", ctx)
    assert exc.value.uuid == "00000000"


@pytest.mark.parametrize("surface", ["combine", "derivation", "assembler"])
def test_resolve_ref_out_of_surface_lenient_emits_empty(surface):
    ctx = _ctx(
        surface=surface,
        strict=False,
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "x")},
    )
    assert resolve_text("a @{a4f7b2e1} thing", ctx) == "a  thing"
    assert any(w["type"] == "ref_out_of_surface" for w in ctx.warnings)


@pytest.mark.parametrize("surface", ["combine", "derivation", "assembler"])
def test_resolve_ref_out_of_surface_strict_raises(surface):
    from engine.syntax import RefOutOfSurfaceError
    ctx = _ctx(
        surface=surface,
        strict=True,
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "x")},
    )
    with pytest.raises(RefOutOfSurfaceError) as exc:
        resolve_text("@{a4f7b2e1}", ctx)
    assert exc.value.surface == surface
    assert exc.value.uuid == "a4f7b2e1"


def test_resolve_ref_recursion_limit_lenient():
    # Build a chain a → b → c → d → e (5 deep) with max_ref_depth=3.
    # Depth-3 resolution returns "" + warning; rest of chain unwinds.
    ctx = _ctx(
        surface="wildcard",
        max_ref_depth=3,
        _modules={
            "a0000001": _wc("a0000001", "a", [{"value": "@{b0000002}", "weight": 1}]),
            "b0000002": _wc("b0000002", "b", [{"value": "@{c0000003}", "weight": 1}]),
            "c0000003": _wc("c0000003", "c", [{"value": "@{d0000004}", "weight": 1}]),
            "d0000004": _wc("d0000004", "d", [{"value": "leaf", "weight": 1}]),
        },
    )
    out = resolve_text("@{a0000001}", ctx)
    # depth 0: a -> resolves "@{b...}" at depth 1
    # depth 1: b -> resolves "@{c...}" at depth 2
    # depth 2: c -> resolves "@{d...}" at depth 3
    # depth 3: REJECTED (>= max_ref_depth) -> ""
    # So output is "" because the chain bottoms out empty.
    assert out == ""
    assert any(w["type"] == "recursion_limit" for w in ctx.warnings)


def test_resolve_ref_cycle_lenient():
    ctx = _ctx(
        surface="wildcard",
        _modules={
            "a0000001": _wc("a0000001", "a", [{"value": "@{b0000002}", "weight": 1}]),
            "b0000002": _wc("b0000002", "b", [{"value": "@{a0000001}", "weight": 1}]),
        },
    )
    out = resolve_text("@{a0000001}", ctx)
    assert out == ""
    cycle_warnings = [w for w in ctx.warnings if w["type"] == "cycle_detected"]
    assert len(cycle_warnings) == 1
    assert cycle_warnings[0]["detail"]["chain"] == ["a0000001", "b0000002", "a0000001"]


def test_resolve_ref_cycle_strict_raises():
    from engine.syntax import CycleDetectedError
    ctx = _ctx(
        surface="wildcard",
        strict=True,
        _modules={
            "a0000001": _wc("a0000001", "a", [{"value": "@{a0000001}", "weight": 1}]),
        },
    )
    with pytest.raises(CycleDetectedError) as exc:
        resolve_text("@{a0000001}", ctx)
    assert exc.value.chain == ["a0000001", "a0000001"]


def test_resolve_ref_weighted_pick_deterministic():
    """Same seed → same pick. Weight skews distribution but still deterministic."""
    ctx1 = _ctx(
        rng=random.Random(42),
        surface="wildcard",
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "x", [
            {"value": "red", "weight": 1},
            {"value": "blue", "weight": 100},
            {"value": "green", "weight": 1},
        ])},
    )
    ctx2 = _ctx(
        rng=random.Random(42),
        surface="wildcard",
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "x", [
            {"value": "red", "weight": 1},
            {"value": "blue", "weight": 100},
            {"value": "green", "weight": 1},
        ])},
    )
    assert resolve_text("@{a4f7b2e1}", ctx1) == resolve_text("@{a4f7b2e1}", ctx2)


def test_resolve_ref_repeated_resolves_independently():
    """Two @{uuid} occurrences sample independently, not cached."""
    ctx = _ctx(
        rng=random.Random(42),
        surface="wildcard",
        _modules={"a4f7b2e1": _wc("a4f7b2e1", "x", [
            {"value": "A", "weight": 1},
            {"value": "B", "weight": 1},
            {"value": "C", "weight": 1},
            {"value": "D", "weight": 1},
        ])},
    )
    # With seed 42 and 4 equiprobable options, two consecutive picks
    # should usually differ. After running once, observe the actual value
    # and pin it for stability.
    out = resolve_text("@{a4f7b2e1}-@{a4f7b2e1}", ctx)
    assert "-" in out
    parts = out.split("-")
    assert len(parts) == 2
    assert parts[0] in {"A", "B", "C", "D"}
    assert parts[1] in {"A", "B", "C", "D"}
    # Pinned from first observed run with seed=42:
    assert out == "C-A"


# ---------------------------------------------------------------------------
# DP_BRACE resolution tests (Task 10)
# ---------------------------------------------------------------------------


def test_resolve_inline_pick_one_of_branches():
    """Single-pick must return one of the branches verbatim (uniformly)."""
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{a|b|c}", ctx)
    assert out in {"a", "b", "c"}


def test_resolve_inline_pick_deterministic_with_seed():
    ctx1 = _ctx(rng=random.Random(42))
    ctx2 = _ctx(rng=random.Random(42))
    assert resolve_text("{x|y|z}", ctx1) == resolve_text("{x|y|z}", ctx2)


def test_resolve_inline_pick_nested_inline():
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{a|{b|c}|d}", ctx)
    assert out in {"a", "b", "c", "d"}


def test_resolve_inline_pick_with_var_in_branch():
    ctx = _ctx(rng=random.Random(0), _vars={"color": "red"})
    out = resolve_text("{$color|blue|green}", ctx)
    # Pick depends on rng; result is one of the resolved branches.
    assert out in {"red", "blue", "green"}


def test_resolve_inline_pick_empty_branch_valid():
    """An empty branch is a valid pick — emits empty string."""
    # Force the empty branch by using a controlled rng. With seed=0 and
    # 3 branches, observe which gets picked; if it's not the empty one,
    # we still verify the resolver doesn't error.
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{a||c}", ctx)
    assert out in {"a", "", "c"}


def test_resolve_inline_pick_single_branch_is_text_token():
    """`{just_one}` is NOT a pick (no pipe) — tokenizer returns it as text,
    so resolver passes through verbatim."""
    ctx = _ctx()
    assert resolve_text("{just_one}", ctx) == "{just_one}"


def test_resolve_inline_pick_literal_on_assembler_surface():
    """Assembler surface is seedless — an inline pick would freeze on one
    branch every run, so it renders the source verbatim instead. $var still
    resolves; only the brace block stays literal."""
    ctx = _ctx(rng=random.Random(0), surface="assembler", _vars={"color": "red"})
    assert resolve_text("$color {a|b|c}", ctx) == "red {a|b|c}"


# ---------------------------------------------------------------------------
# DP_MULTI resolution tests (Task 11)
# ---------------------------------------------------------------------------


def test_resolve_multi_pick_zero_count_empty():
    ctx = _ctx(rng=random.Random(0))
    assert resolve_text("{0$$, $$a|b|c}", ctx) == ""


def test_resolve_multi_pick_returns_joined():
    ctx = _ctx(rng=random.Random(42))
    out = resolve_text("{2$$, $$a|b|c|d}", ctx)
    parts = out.split(", ")
    assert len(parts) == 2
    assert all(p in {"a", "b", "c", "d"} for p in parts)


def test_resolve_multi_pick_no_duplicates_without_replacement():
    """Without replacement: same branch can't appear twice."""
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{3$$, $$a|b|c|d|e}", ctx)
    parts = out.split(", ")
    assert len(parts) == 3
    assert len(set(parts)) == 3, f"duplicates in without-replacement pick: {parts}"


def test_resolve_multi_pick_clamps_when_n_exceeds_branches():
    """N=5, branches=3 → only 3 picks emitted."""
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{5$$, $$a|b|c}", ctx)
    parts = out.split(", ")
    assert len(parts) == 3
    assert sorted(parts) == ["a", "b", "c"]


def test_resolve_multi_pick_empty_sep_concatenates():
    ctx = _ctx(rng=random.Random(0))
    out = resolve_text("{2$$$$X|Y|Z}", ctx)
    # No separator between two picks
    assert len(out) == 2  # two single-char picks concatenated
    assert all(c in "XYZ" for c in out)


def test_resolve_multi_pick_branches_can_contain_refs():
    ctx = _ctx(
        rng=random.Random(0),
        surface="wildcard",
        _modules={
            "a0000001": _wc("a0000001", "a", [{"value": "red", "weight": 1}]),
            "b0000002": _wc("b0000002", "b", [{"value": "blue", "weight": 1}]),
        },
    )
    out = resolve_text("{2$$, $$@{a0000001}|@{b0000002}|green}", ctx)
    parts = out.split(", ")
    assert len(parts) == 2
