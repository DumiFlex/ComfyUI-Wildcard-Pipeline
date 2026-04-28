"""Token-walking resolver. Mirrors `resolveTokens.ts` (Task 12 will land that).

Each token kind has a `_resolve_<kind>` helper. The main loop walks tokens
left-to-right, dispatches by kind, and concatenates results. Recursion
happens inside `_resolve_ref` (Task 9) and brace resolvers (Tasks 10–11).
"""
from __future__ import annotations

import logging

from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import (
    CycleDetectedError,
    RecursionLimitExceeded,
    RefOutOfSurfaceError,
    ResolveContext,
    Token,
    TokenKind,
    UnknownRefError,
)

logger = logging.getLogger(__name__)


def resolve_text(text: str, ctx: ResolveContext) -> str:
    """Resolve `text` against `ctx`, returning the final string.

    Walks tokens once; for each token, dispatches to a per-kind resolver.
    `depth` and `visited` are managed internally during ref recursion.
    """
    tokens = tokenize_text(text)
    return _resolve_tokens(tokens, ctx, depth=0, visited=())


def _resolve_tokens(
    tokens: list[Token],
    ctx: ResolveContext,
    depth: int,
    visited: tuple[str, ...],
) -> str:
    parts: list[str] = []
    for tok in tokens:
        if tok.kind == TokenKind.TEXT:
            parts.append(tok.raw)
        elif tok.kind == TokenKind.ESCAPE:
            parts.append(tok.meta.get("literal", ""))
        elif tok.kind == TokenKind.VAR:
            parts.append(_resolve_var(tok, ctx))
        elif tok.kind == TokenKind.REF:
            parts.append(_resolve_ref(tok, ctx, depth, visited))
        elif tok.kind == TokenKind.DP_BRACE:
            # Implemented in Task 10
            raise NotImplementedError("DP_BRACE resolution lands in Task 10")
        elif tok.kind == TokenKind.DP_MULTI:
            # Implemented in Task 11
            raise NotImplementedError("DP_MULTI resolution lands in Task 11")
        elif tok.kind == TokenKind.DP_PIPE:
            # DP_PIPE is never emitted as a top-level token by the current
            # tokenizer (pipes are absorbed into branch boundaries). If one
            # appears here, that's a tokenizer bug.
            raise AssertionError("DP_PIPE should never be top-level")
        else:
            raise AssertionError(f"unknown token kind: {tok.kind}")
    return "".join(parts)


def _resolve_var(tok: Token, ctx: ResolveContext) -> str:
    """Look up a variable in ctx. Returns empty string for missing or internal-key vars."""
    name = tok.meta.get("name", "")
    if name.startswith("__"):
        # Engine-internal keys are never substituted.
        return ""
    value = ctx.get_var(name)
    if value is None:
        # TODO(task-9-onward): push warning when unknown var? Spec doesn't
        # explicitly call out unknown vars as warnings; they emit "" silently.
        # Revisit if user feedback shows confusion.
        return ""
    return str(value)


def _push_warning(ctx: ResolveContext, **fields) -> None:
    """Append a warning dict to ctx.warnings. Helper to keep call sites tidy."""
    ctx.warnings.append(fields)


def _pick_weighted(options: list[dict], rng) -> dict | None:
    """Pick one option weighted by `weight`. Returns None for empty list.

    Mirrors the pre-Phase-5 wildcard_handler._pick_weighted but takes `rng`
    as an explicit parameter instead of using random.random().
    """
    if not options:
        return None
    total = sum(max(0.0, float(o.get("weight", 1))) for o in options)
    if total <= 0:
        return options[0]
    r = rng.random() * total
    acc = 0.0
    for opt in options:
        acc += max(0.0, float(opt.get("weight", 1)))
        if r <= acc:
            return opt
    return options[-1]


def _resolve_ref(
    tok: Token,
    ctx: ResolveContext,
    depth: int,
    visited: tuple[str, ...],
) -> str:
    uuid = tok.meta.get("uuid", "")

    # Depth check (first — prevents infinite recursion even on cyclic graphs)
    if depth >= ctx.max_ref_depth:
        chain = list(visited) + [uuid]
        if ctx.strict:
            raise RecursionLimitExceeded(
                f"max ref depth {ctx.max_ref_depth} exceeded: "
                + " → ".join(f"@{{{u}}}" for u in chain)
            )
        _push_warning(
            ctx,
            type="recursion_limit",
            severity="error",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"chain": chain, "limit": ctx.max_ref_depth},
            message=f"Recursion limit reached at depth {ctx.max_ref_depth}",
        )
        return ""

    # Cycle check
    if uuid in visited:
        chain = list(visited) + [uuid]
        if ctx.strict:
            raise CycleDetectedError(chain)
        _push_warning(
            ctx,
            type="cycle_detected",
            severity="error",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"chain": chain},
            message="Cycle: " + " → ".join(f"@{{{u}}}" for u in chain),
        )
        return ""

    # Surface check
    if ctx.surface != "wildcard":
        if ctx.strict:
            raise RefOutOfSurfaceError(uuid, ctx.surface)
        # Try to resolve module name for the warning detail (best-effort)
        module = ctx.get_module(uuid)
        name = module.get("var_binding") if module else None
        _push_warning(
            ctx,
            type="ref_out_of_surface",
            severity="info",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"uuid": uuid, "name": name, "surface": ctx.surface},
            message=f"@{{{uuid}}} ignored in {ctx.surface!r} surface",
        )
        return ""

    # Catalog lookup
    module = ctx.get_module(uuid)
    if module is None:
        if ctx.strict:
            raise UnknownRefError(uuid)
        _push_warning(
            ctx,
            type="unknown_ref",
            severity="warn",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"uuid": uuid, "name": None},
            message=f"Unknown wildcard ref @{{{uuid}}}",
        )
        return ""

    # Pick weighted option
    options = module.get("options", [])
    chosen = _pick_weighted(options, ctx.rng)
    if chosen is None:
        return ""

    chosen_value = str(chosen.get("value", ""))
    if not chosen_value:
        return ""

    # Recursive resolve with depth+1, visited extended
    nested_tokens = tokenize_text(chosen_value)
    return _resolve_tokens(nested_tokens, ctx, depth=depth + 1, visited=visited + (uuid,))
