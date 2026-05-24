"""Dangling-var rule — strip `$var` tokens the engine flagged as unbound.

Reads ctx.warnings for entries with type='unknown_var', collects the
referenced var names, then removes `$var` occurrences from the
prompt. Respects `\\$var` escapes — they stay.
"""
from engine.cleaner.rules.dangling_var import apply
from engine.cleaner.types import CleanerCtx


def _ctx_with_unbound(*names: str) -> CleanerCtx:
    return CleanerCtx(
        warnings=[
            {"type": "unknown_var", "detail": {"name": name}}
            for name in names
        ],
    )


def test_strips_unbound_var():
    ctx = _ctx_with_unbound("artist")
    result = apply("portrait by $artist, sunset", mode="text", ctx=ctx, config={})
    assert result["text"] == "portrait by , sunset"
    assert result["stats"]["stripped"] == ["$artist"]


def test_leaves_bound_var_alone():
    """Vars NOT in warnings list are bound — leave them."""
    ctx = _ctx_with_unbound("artist")
    result = apply("$style by $artist", mode="text", ctx=ctx, config={})
    assert result["text"] == "$style by "
    assert result["stats"]["stripped"] == ["$artist"]


def test_respects_escape_sequence():
    """`\\$var` is a literal — never strip even if `var` is unbound."""
    ctx = _ctx_with_unbound("artist")
    result = apply(r"\$artist literal", mode="text", ctx=ctx, config={})
    assert result["text"] == r"\$artist literal"
    assert result["stats"]["stripped"] == []


def test_silent_skip_when_ctx_none():
    result = apply("$artist", mode="text", ctx=None, config={})
    assert result["text"] == "$artist"
    assert result["stats"] == {}


def test_no_warnings_no_op():
    ctx = CleanerCtx(warnings=[])
    result = apply("$artist", mode="text", ctx=ctx, config={})
    assert result["text"] == "$artist"
    assert result["stats"] == {"stripped": []}
