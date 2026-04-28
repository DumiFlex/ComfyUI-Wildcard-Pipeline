"""Token-walking resolver. Mirrors `resolveTokens.ts` (Task 12 will land that).

Each token kind has a `_resolve_<kind>` helper. The main loop walks tokens
left-to-right, dispatches by kind, and concatenates results. Recursion
happens inside `_resolve_ref` (Task 9) and brace resolvers (Tasks 10–11).
"""
from __future__ import annotations

from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import ResolveContext, Token, TokenKind


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
            # Implemented in Task 9
            raise NotImplementedError("REF resolution lands in Task 9")
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
