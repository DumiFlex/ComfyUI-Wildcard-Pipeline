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
            parts.append(_resolve_inline_pick(tok, ctx, depth, visited))
        elif tok.kind == TokenKind.DP_MULTI:
            parts.append(_resolve_multi_pick(tok, ctx, depth, visited))
        elif tok.kind == TokenKind.DP_PIPE:
            # DP_PIPE is never emitted as a top-level token by the current
            # tokenizer (pipes are absorbed into branch boundaries). If one
            # appears here, that's a tokenizer bug.
            raise AssertionError("DP_PIPE should never be top-level")
        else:
            raise AssertionError(f"unknown token kind: {tok.kind}")
    return "".join(parts)


_VAR_SURFACES_ALLOWED = frozenset(["combine", "derivation", "assembler"])


def _resolve_var(tok: Token, ctx: ResolveContext) -> str:
    """Look up a variable in ctx. Returns empty string for missing or
    internal-key vars. Missing vars also emit an `unknown_var` warning so
    the user gets a signal when a Combine / Derivation / Constraint
    template references a variable not bound by any upstream module.

    Internal-`__`-prefixed keys are never substituted and never warn —
    they're engine bookkeeping (`__wp_rng__`, `__wp_catalog__`, etc.).

    Surface-gated: only combine/derivation/assembler surfaces support
    $var reads. Wildcard + fixed_values surfaces are binding PRODUCERS
    (not consumers); $var reads there warn + render literal in lenient
    mode, raise VarOutOfSurfaceError in strict mode."""
    name = tok.meta.get("name", "")
    if name.startswith("__"):
        return ""
    if ctx.surface not in _VAR_SURFACES_ALLOWED:
        from engine.syntax.types import VarOutOfSurfaceError
        if ctx.strict:
            raise VarOutOfSurfaceError(name, ctx.surface)
        _push_warning(
            ctx,
            type="var_out_of_surface",
            severity="warn",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"name": name, "surface": ctx.surface},
            message=(
                f"${name} ignored in {ctx.surface!r} surface — only "
                f"combine / derivation / assembler surfaces support $var reads"
            ),
        )
        return f"${name}"
    value = ctx.get_var(name)
    if value is None:
        _push_warning(
            ctx,
            type="unknown_var",
            severity="warn",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"name": name, "surface": ctx.surface},
            message=f"Unknown variable ${name}",
        )
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


def _resolve_inline_pick(
    tok: Token,
    ctx: ResolveContext,
    depth: int,
    visited: tuple[str, ...],
) -> str:
    """Pick one branch uniformly at random; recursively resolve its content."""
    branches: list[str] = tok.meta.get("branches", [])
    if not branches:
        return ""
    chosen_idx = ctx.rng.randrange(len(branches))
    chosen = branches[chosen_idx]
    if not chosen:
        return ""
    nested_tokens = tokenize_text(chosen)
    return _resolve_tokens(nested_tokens, ctx, depth=depth, visited=visited)


def _parse_branch_weight(branch: str) -> float:
    """Parse `N::value` micro-syntax. Returns 1.0 if no prefix."""
    if "::" not in branch:
        return 1.0
    prefix, _, _ = branch.partition("::")
    try:
        n = float(prefix)
        if n <= 0:
            return 0.0
        return n
    except ValueError:
        return 1.0


def _strip_branch_weight(branch: str) -> str:
    """Return branch text without the `N::` weight prefix, if present."""
    if "::" not in branch:
        return branch
    prefix, _, rest = branch.partition("::")
    try:
        float(prefix)
        return rest
    except ValueError:
        return branch


def _weighted_pick_index(weights: list[float], rng) -> int:
    """Return an index into `weights` weighted by value. Total > 0 assumed."""
    total = sum(max(0.0, w) for w in weights)
    if total <= 0:
        return 0
    r = rng.random() * total
    acc = 0.0
    for idx, w in enumerate(weights):
        acc += max(0.0, w)
        if r <= acc:
            return idx
    return len(weights) - 1


def _resolve_multi_pick(
    tok: Token,
    ctx: ResolveContext,
    depth: int,
    visited: tuple[str, ...],
) -> str:
    """Pick `count` branches without replacement, weighted, joined by `sep`.

    Each chosen branch is recursively resolved.
    """
    count: int = tok.meta.get("count", 0)
    sep: str = tok.meta.get("sep", "")
    branches: list[str] = list(tok.meta.get("branches", []))

    if count <= 0:
        return ""

    # Clamp count to available branches (without-replacement constraint)
    n_picks = min(count, len(branches))
    if n_picks == 0:
        return ""

    # Weighted without-replacement: branch weights default to 1; if a branch
    # uses the `N::value` form (a feature of the inline-pick weight micro-syntax),
    # the weight is parsed from the prefix. For simplicity, this implementation
    # treats all branches as weight=1 unless they begin with `<int>::`.
    weights = [_parse_branch_weight(b) for b in branches]
    branch_values = [_strip_branch_weight(b) for b in branches]

    chosen_indices: list[int] = []
    available_indices = list(range(len(branches)))
    available_weights = list(weights)

    for _ in range(n_picks):
        if not available_indices:
            break
        idx = _weighted_pick_index(available_weights, ctx.rng)
        chosen_indices.append(available_indices.pop(idx))
        available_weights.pop(idx)

    resolved: list[str] = []
    for idx in chosen_indices:
        branch_text = branch_values[idx]
        if not branch_text:
            resolved.append("")
            continue
        nested = tokenize_text(branch_text)
        resolved.append(_resolve_tokens(nested, ctx, depth=depth, visited=visited))

    return sep.join(resolved)


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
        # Surface the cached `#name` from the ref token if the original
        # syntax carried one (`@{uuid#name}`). Lets WP_Debug + RichTextPreview
        # render a friendly label even when the target wildcard has been
        # deleted from the library — same fallback chain RichTextPreview
        # uses for unresolved chips elsewhere.
        cached_name = tok.meta.get("name") if hasattr(tok, "meta") else None
        _push_warning(
            ctx,
            type="unknown_ref",
            severity="warn",
            module_id="",
            source_field="",
            position=tok.start,
            token_index=None,
            detail={"uuid": uuid, "name": cached_name},
            message=f"Unknown wildcard ref @{{{uuid}{'#' + cached_name if cached_name else ''}}}",
        )
        return ""

    # Pick weighted option.
    # Support both SnapshotEntry shape (payload.options, spec §2.4) and the
    # legacy flat shape used by existing unit tests (options at top level).
    payload_dict = module.get("payload")
    if isinstance(payload_dict, dict):
        options = list(payload_dict.get("options", []))
    else:
        options = list(module.get("options", []))

    # Optional per-call sub-category filter: `@{uuid:warm,cool}` keeps
    # only options whose `sub_category` is in the requested list. Same
    # semantics as chain-level `instance.category_filter` but scoped to
    # this specific ref, so a shared library wildcard (e.g. `@{color}`)
    # can be narrowed differently at every call site without authoring
    # separate library entries. Empty post-filter pool → empty string
    # + warning so the user sees the unsatisfiable filter rather than
    # silently falling through to the unfiltered list.
    #
    # Null semantics (inverted 2026-05-25): the wildcard's `is_null`
    # option is INCLUDED by default — alongside whatever sub-cats the
    # filter lists. The reserved keyword `"null"` in the filter list
    # EXCLUDES the null option from the pool. So:
    #   `@{uuid}`              → all options (incl. null)
    #   `@{uuid:warm}`         → warm options + null
    #   `@{uuid:warm,null}`    → warm options, null excluded
    #   `@{uuid:null}`         → all non-null options (filter-only-null
    #                             = "exclude null, no sub-cat filter")
    # Sub-category names called literally `"null"` are forbidden by
    # WildcardHandler.validate_payload so the keyword can never clash
    # with a real sub-cat.
    sub_filter = tok.meta.get("sub_categories")
    if isinstance(sub_filter, list) and sub_filter:
        allowed_subs = set(sub_filter)
        exclude_null = "null" in allowed_subs
        allowed_subs.discard("null")
        options = [
            o for o in options
            if isinstance(o, dict)
            and (
                (o.get("is_null") and not exclude_null)
                or (
                    not o.get("is_null")
                    and (not allowed_subs or o.get("sub_category") in allowed_subs)
                )
            )
        ]
        if not options:
            _push_warning(
                ctx,
                type="ref_subcategory_empty_pool",
                severity="warn",
                module_id="",
                source_field="",
                position=tok.start,
                token_index=None,
                detail={"uuid": uuid, "sub_categories": list(sub_filter)},
                message=(
                    f"@{{{uuid}:{','.join(sub_filter)}}} matched no options"
                ),
            )
            return ""

    # Apply chain-level constraints whose `target_wildcard_id` matches
    # this nested ref's uuid. Pre-2026-05 only top-level wildcards saw
    # constraints — nested `@{B}` from inside another wildcard's
    # option value silently bypassed every rule, defeating composed
    # pipelines. ResolveContext exposes `get_constraints` / `get_picks`
    # for this path; both default to empty for hand-built resolve
    # contexts in tests so the legacy fast path keeps working.
    get_constraints = getattr(ctx, "get_constraints", None)
    get_picks = getattr(ctx, "get_picks", None)
    if callable(get_constraints) and callable(get_picks):
        constraints = get_constraints()
        if constraints:
            from engine.modules._constraints import (
                apply_constraints_for_target,
                warn_excludes_all,
            )
            # First-instance one-shot semantic: thread the consumed
            # set so this nested-ref resolve path participates in the
            # same one-shot bookkeeping as top-level wildcard rolls.
            # See docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md.
            get_consumed = getattr(ctx, "get_consumed_constraints", None)
            consumed = get_consumed() if callable(get_consumed) else set()
            options, any_applied = apply_constraints_for_target(
                options, uuid, constraints, get_picks(), ctx.warnings,
                consumed=consumed,
            )
            if any_applied:
                warn_excludes_all(options, uuid, ctx.warnings)

    chosen = _pick_weighted(options, ctx.rng)
    if chosen is None:
        return ""

    chosen_value = str(chosen.get("value", ""))
    if not chosen_value:
        return ""

    # Recursive resolve with depth+1, visited extended
    nested_tokens = tokenize_text(chosen_value)
    return _resolve_tokens(nested_tokens, ctx, depth=depth + 1, visited=visited + (uuid,))
