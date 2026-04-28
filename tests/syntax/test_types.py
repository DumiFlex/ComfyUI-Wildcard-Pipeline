"""Test the foundational types and error class hierarchy."""
from __future__ import annotations

from engine.syntax import types as st


def test_token_kind_values():
    """All expected token kinds present, no extras."""
    expected = {"text", "var", "ref", "dp_brace", "dp_pipe", "dp_multi", "escape"}
    actual = {k.value for k in st.TokenKind}
    assert actual == expected


def test_token_dataclass_shape():
    tok = st.Token(kind=st.TokenKind.TEXT, raw="hello", start=0, end=5, meta={})
    assert tok.kind == st.TokenKind.TEXT
    assert tok.raw == "hello"
    assert tok.start == 0
    assert tok.end == 5
    assert tok.meta == {}


def test_unknown_ref_error_carries_uuid():
    err = st.UnknownRefError("a4f7b2e1")
    assert err.uuid == "a4f7b2e1"
    assert "a4f7b2e1" in str(err)


def test_ref_out_of_surface_error_carries_uuid_and_surface():
    err = st.RefOutOfSurfaceError("a4f7b2e1", "combine")
    assert err.uuid == "a4f7b2e1"
    assert err.surface == "combine"
    assert "combine" in str(err)


def test_cycle_detected_error_carries_chain():
    err = st.CycleDetectedError(["a", "b", "a"])
    assert err.chain == ["a", "b", "a"]
    assert "@{a}" in str(err)
    assert "@{b}" in str(err)


def test_recursion_limit_exceeded_is_distinct_class():
    """Distinct from CycleDetectedError so handlers can distinguish."""
    assert issubclass(st.RecursionLimitExceeded, st.SyntaxError)
    assert not issubclass(st.RecursionLimitExceeded, st.CycleDetectedError)


def test_malformed_syntax_error_is_distinct_class():
    assert issubclass(st.MalformedSyntaxError, st.SyntaxError)


def test_resolve_context_protocol_runtime_check():
    """ResolveContext is a Protocol — duck-typeable."""
    import random

    class FakeCtx:
        rng = random.Random(42)
        max_ref_depth = 8
        strict = False
        surface = "wildcard"
        developer_mode = False
        warnings: list = []

        def get_var(self, name: str) -> str | None:
            return None

        def get_module(self, uuid: str) -> dict | None:
            return None

    # Should accept any object with the right attribute / method shape.
    ctx: st.ResolveContext = FakeCtx()
    assert ctx.surface == "wildcard"
    assert ctx.get_var("x") is None
