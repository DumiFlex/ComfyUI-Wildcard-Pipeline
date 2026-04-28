"""Template variable substitution shim. Wraps engine/syntax/resolve_text.

Pre-Phase-5 this file held an ad-hoc `$var` regex. Phase 5 unified all
template resolution into engine/syntax. This module preserves the public
function name + signature so `wp_nodes/assembler_node.py` doesn't change.
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules import build_resolve_ctx
from engine.syntax import resolve_text

_WS_RUN = re.compile(r"[ \t]{2,}")
_COMMA_GAP = re.compile(r",\s*,")
_TRIM_PUNCT = re.compile(r"\s+([,.;:!?])")


def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Resolve `$var` / `@{uuid}` / `{a|b|c}` / `{N$$sep$$...}` against ctx.

    Surface defaults to "assembler" (matches wp_nodes/assembler_node.py
    usage). For a different surface, call resolve_text directly with a
    custom ResolveContext.
    """
    if not template:
        return ""

    # Ensure required ctx keys exist (callers from the old API may not provide them)
    if "__wp_rng__" not in ctx:
        import random  # noqa: PLC0415
        ctx["__wp_rng__"] = random.Random(int(ctx.get("__wp_node_seed__", 0)))
    ctx.setdefault("__wp_warnings__", [])

    rctx = build_resolve_ctx(ctx, surface="assembler")
    out = resolve_text(template, rctx)

    # Whitespace cleanup post-pass (preserves the original API's behavior
    # for templates that drop missing variables)
    out = _WS_RUN.sub(" ", out)
    out = _COMMA_GAP.sub(",", out)
    out = _TRIM_PUNCT.sub(r"\1", out)
    return out.strip()
