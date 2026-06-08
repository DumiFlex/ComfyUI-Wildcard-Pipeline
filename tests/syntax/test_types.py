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


def test_listvar_str_joins_items():
    """SP2a: str(ListVar) joins with sep (NOT the dataclass repr) so a list
    value that leaks into a plain str() context renders as the user-facing
    joined string rather than `ListVar(items=[...], sep=...)`."""
    assert str(st.ListVar(items=["red", "blue"], sep=", ")) == "red, blue"
    assert str(st.ListVar(items=[], sep=", ")) == ""


def test_split_var_accessor_separates_base_and_index():
    assert st.split_var_accessor("mood.0") == ("mood", 0)
    assert st.split_var_accessor("mood.12") == ("mood", 12)
    assert st.split_var_accessor("mood") == ("mood", None)
    # Not an `ident.digits` shape -> returned whole, no index.
    assert st.split_var_accessor("weird.name") == ("weird.name", None)
    assert st.split_var_accessor("") == ("", None)


def test_deref_var_value_honors_listvar_and_accessor():
    lv = st.ListVar(items=["a", "b"], sep="/")
    assert st.deref_var_value(lv, None) == "a/b"
    assert st.deref_var_value(lv, 0) == "a"
    assert st.deref_var_value(lv, 5) == ""  # out of range -> ""
    # Plain string behaves as a 1-element list.
    assert st.deref_var_value("x", None) == "x"
    assert st.deref_var_value("x", 0) == "x"
    assert st.deref_var_value("x", 1) == ""
    assert st.deref_var_value(None, None) == ""


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
