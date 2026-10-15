"""Template variable substitution shim. Wraps engine/syntax/resolve_text.

Pre-Phase-5 this file held an ad-hoc `$var` regex. Phase 5 unified all
template resolution into engine/syntax. This module preserves the public
function name + signature so `wp_nodes/assembler_node.py` doesn't change.
"""
from __future__ import annotations

import re
from typing import Any

from engine import negatives
from engine.modules import build_resolve_ctx
from engine.syntax import resolve_text
from engine.syntax.types import ListVar, deref_var_value

_WS_RUN = re.compile(r"[ \t]{2,}")
_COMMA_GAP = re.compile(r",\s*,")
# A space before punctuation goes ("rain ." → "rain."), but not inside
# emoticon tags (", :d", ", :3", "!?").
_TRIM_COMMA = re.compile(r"\s+,")
_TRIM_PUNCT = re.compile(r"(?<![,;:!?\s])\s+([.;:!?])(?=\s|$)")
#: Where a variable came out empty, so the tidy below only touches the
#: words it left behind (never a tag like "shirt tucked in").
_EMPTY = "\ue000"
_READ = re.compile(r"(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)\b(?![.\w])")
# A joining word an empty variable left with nothing after it ("shadows
# with, rain", "wearing with,"): it goes, with any article before it.
_DANGLING = re.compile(r"(?:\s+|^)(?:with|and|or|in|of|on|at|under|by|from|the|a|an)"
                       r"(?=\s*\ue000[\s\ue000]*(?:,|$))", re.I)
# "wearing a a striped shirt": an article the template wrote next to one
# the value starts with.
_TWO_ARTICLES = re.compile(r"\b(?:a|an|the)\s+(?=(?:a|an|the)\s)", re.I)
_EDGE_COMMAS = re.compile(r"^[\s,]+|[\s,]+$")


def resolve_variables(
    template: str,
    ctx: dict[str, Any],
    *,
    reads: list[tuple[str, Any]] | None = None,
) -> str:
    """Resolve `$var` / `@{uuid}` / `{a|b|c}` / `{N$$sep$$...}` against ctx.

    Surface defaults to "assembler" (matches wp_nodes/assembler_node.py
    usage). For a different surface, call resolve_text directly with a
    custom ResolveContext.

    `reads`, when given, receives one `(name, index)` per `$var` the
    template rendered — what send-to-negative collects negatives from.
    """
    return tidy_prompt(resolve_variables_raw(_mark_empty(template or "", ctx), ctx,
                                             reads=reads))


def _mark_empty(template: str, ctx: dict[str, Any]) -> str:
    """``template`` with a marker after each plain ``$var`` read that will
    come out empty, for ``tidy_prompt``."""
    def sub(m: re.Match[str]) -> str:
        v = ctx.get(m.group(1))
        # Judged on what the read renders: a multi-pick that drew nothing (an
        # empty ListVar, or only blank picks) is as empty as "".
        empty = v is None or (
            isinstance(v, (str, ListVar)) and not deref_var_value(v, None).strip()
        )
        return m.group(0) + _EMPTY if empty else m.group(0)
    return _READ.sub(sub, template)


def resolve_variables_raw(
    template: str,
    ctx: dict[str, Any],
    *,
    reads: list[tuple[str, Any]] | None = None,
) -> str:
    """`resolve_variables` without the whitespace cleanup, for callers that
    splice several resolved pieces together before tidying once."""
    if not template:
        return ""

    # Ensure required ctx keys exist (callers from the old API may not provide them)
    if "__wp_rng__" not in ctx:
        import random  # noqa: PLC0415
        ctx["__wp_rng__"] = random.Random(int(ctx.get("__wp_node_seed__", 0)))
    ctx.setdefault("__wp_warnings__", [])

    rctx = build_resolve_ctx(ctx, surface="assembler")
    if reads is None:
        return resolve_text(template, rctx)
    with negatives.collecting(rctx) as col:
        out = resolve_text(template, rctx)
    reads.extend(col.reads)
    return out


def tidy_prompt(out: str) -> str:
    """Whitespace cleanup post-pass (preserves the original API's behavior
    for templates that drop missing variables)."""
    out = _WS_RUN.sub(" ", out)
    out = _TWO_ARTICLES.sub("", out)
    while True:
        bare = _DANGLING.sub("", out)
        if bare == out:
            break
        out = bare
    out = out.replace(_EMPTY, "")
    out = _WS_RUN.sub(" ", out)
    out = _COMMA_GAP.sub(",", out)
    while _COMMA_GAP.search(out):
        out = _COMMA_GAP.sub(",", out)
    out = _TRIM_COMMA.sub(",", out)
    out = _TRIM_PUNCT.sub(r"\1", out)
    # The commas an empty first or last variable leaves ("dawn, cloudy day,").
    return _EDGE_COMMAS.sub("", out)
