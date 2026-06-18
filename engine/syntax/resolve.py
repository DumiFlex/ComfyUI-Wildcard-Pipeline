"""Token-walking resolver. Mirrors `resolveTokens.ts` (Task 12 will land that).

Each token kind has a `_resolve_<kind>` helper. The main loop walks tokens
left-to-right, dispatches by kind, and concatenates results. Recursion
happens inside `_resolve_ref` (Task 9) and brace resolvers (Tasks 10–11).
"""
from __future__ import annotations

import logging

from engine.syntax.subcat_filter import matches as _subcat_matches
from engine.syntax.subcat_filter import parse as _parse_subcat
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import (
    CycleDetectedError,
    RecursionLimitExceeded,
    RefOutOfSurfaceError,
    ResolveContext,
    Token,
    TokenKind,
    UnknownRefError,
    deref_var_value,
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
    # SP2a list accessor: `$name` joins a ListVar with its separator;
    # `$name.K` indexes (0-based, out-of-range -> ""). A plain string behaves
    # as a 1-element list so `$str.0` == `$str` and `$str.1` == "". The
    # accessor + ListVar-fold contract lives in deref_var_value
    # (engine/syntax/types.py); the derivation + converter reads share it.
    return deref_var_value(value, tok.meta.get("index"))


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
    # Assembler surface is seedless — its RNG always rolls from seed 0, so
    # an inline pick there would freeze on the same branch every run. That's
    # misleading, so render the source verbatim instead and let the user
    # produce the random value in a seeded module (Wildcard / Combine /
    # Derivation inside a WP Context) and reference its $var here. Other
    # surfaces (wildcard / combine / derivation) run inside a seeded Context
    # and keep resolving normally.
    if ctx.surface == "assembler":
        return tok.raw
    branches: list[str] = tok.meta.get("branches", [])
    if not branches:
        return ""
    # Per-branch weights (`N::value`), same micro-syntax the multi-pick block
    # honors. Strip the prefix off every branch so it never leaks into output;
    # only switch to weighted selection when a branch actually carries a weight,
    # so unweighted `{a|b|c}` keeps its byte-for-byte seed sequence (legacy
    # randrange path — changing the draw would shift every existing seed).
    values = [_strip_branch_weight(b) for b in branches]
    has_weights = any(v != b for v, b in zip(values, branches, strict=True))
    if has_weights:
        weights = [_parse_branch_weight(b) for b in branches]
        chosen_idx = _weighted_pick_index(weights, ctx.rng)
    else:
        chosen_idx = ctx.rng.randrange(len(branches))
    chosen = values[chosen_idx]
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


def pick_k_unique(items, weights, k, rng):
    """Pick ``k`` items from ``items`` without replacement, weighted by the
    parallel ``weights`` list, returned in pick order. ``k`` is clamped to
    ``len(items)``; ``k <= 0`` -> ``[]``.

    Shared by the inline ``{N$$sep$$}`` block (``_resolve_multi_pick``) and by
    multi-select wildcards (``wildcard_handler``). Draws from ``rng`` in the
    same order the inline block always has, so seed behavior is unchanged.
    """
    n = min(max(0, k), len(items))
    available_idx = list(range(len(items)))
    available_w = list(weights)
    chosen = []
    for _ in range(n):
        if not available_idx:
            break
        j = _weighted_pick_index(available_w, rng)
        chosen.append(items[available_idx.pop(j)])
        available_w.pop(j)
    return chosen


def _resolve_multi_pick(
    tok: Token,
    ctx: ResolveContext,
    depth: int,
    visited: tuple[str, ...],
) -> str:
    """Resolve a multi-pick block, joined by `sep`.

    SP2b: `count` is a range `[min, max]` (a fixed `{N$$}` has min==max), and
    `independent` (the `~` flag) toggles unique-without-replacement (default)
    vs N draws WITH replacement. A lone nested-ref body in unique mode draws N
    DISTINCT options from the ref's filtered pool (a per-site SP2a). Each chosen
    value is recursively resolved.
    """
    # Seedless assembler surface — see _resolve_inline_pick. Render verbatim
    # rather than freezing a deterministic seed-0 multi-pick.
    if ctx.surface == "assembler":
        return tok.raw
    cmin: int = tok.meta.get("min", tok.meta.get("count", 0))
    cmax: int = tok.meta.get("max", tok.meta.get("count", 0))
    independent: bool = bool(tok.meta.get("independent", False))
    sep: str = tok.meta.get("sep", "")
    branches: list[str] = list(tok.meta.get("branches", []))

    # Range count: a fixed N (min==max) does NOT draw from rng, so a `{N$$}`
    # reproduces the pre-SP2b seed sequence byte-for-byte. A true range draws.
    count = cmin if cmin == cmax else ctx.rng.randint(cmin, cmax)
    if count <= 0:
        return ""

    # Lone nested-ref body, unique mode, count>=2, wildcard surface → pick N
    # DISTINCT options from the ref's filtered pool (per-site SP2a multi-select).
    # count==1 stays on the legacy branch path below so its seed is unchanged.
    if not independent and count >= 2 and len(branches) == 1 and ctx.surface == "wildcard":
        bt = tokenize_text(branches[0])
        if len(bt) == 1 and bt[0].kind == TokenKind.REF:
            ref_tok = bt[0]
            ref_uuid = ref_tok.meta.get("uuid", "")
            pool = ref_option_pool(ref_tok, ctx)
            if not pool:
                return ""
            values = [str(o.get("value", "")) for o in pool]
            weights = [float(o.get("weight", 1) or 1) for o in pool]
            chosen = pick_k_unique(values, weights, count, ctx.rng)
            # The multi-picked ref is the carrier of any `@{X}` inside the
            # values it resolves. We pick on VALUES (not option dicts) so a
            # specific option id isn't tracked here — set carrier to
            # (ref_uuid, None) for the recursion. option_id None can't match
            # a real `pick` entry, so a deeper `@{X}` falls back to
            # positional first/next/all (design: multi-pick children aren't
            # individually pickable). Restore the enclosing carrier after.
            get_carrier = getattr(ctx, "get_carrier", None)
            set_carrier = getattr(ctx, "set_carrier", None)
            saved_carrier = (
                get_carrier() if callable(get_carrier) else None
            )
            if callable(set_carrier):
                set_carrier(ref_uuid, None)
            try:
                return sep.join(
                    _resolve_tokens(
                        tokenize_text(v), ctx, depth=depth + 1,
                        visited=visited + (ref_uuid,),
                    ) if v else ""
                    for v in chosen
                )
            finally:
                if callable(set_carrier) and saved_carrier is not None:
                    set_carrier(*saved_carrier)

    weights = [_parse_branch_weight(b) for b in branches]
    branch_values = [_strip_branch_weight(b) for b in branches]
    resolved: list[str] = []

    if independent:
        # N draws WITH replacement over the branches; each resolved
        # independently (a lone ref re-rolls every time → variety from nesting).
        for _ in range(count):
            j = _weighted_pick_index(weights, ctx.rng)
            v = branch_values[j]
            resolved.append(
                _resolve_tokens(tokenize_text(v), ctx, depth=depth, visited=visited)
                if v else ""
            )
        return sep.join(resolved)

    # Unique over branches (legacy path, now range-aware): N distinct branches.
    n_picks = min(count, len(branches))
    if n_picks == 0:
        return ""
    chosen_values = pick_k_unique(branch_values, weights, n_picks, ctx.rng)
    for branch_text in chosen_values:
        if not branch_text:
            resolved.append("")
            continue
        nested = tokenize_text(branch_text)
        resolved.append(_resolve_tokens(nested, ctx, depth=depth, visited=visited))

    return sep.join(resolved)


def ref_option_pool(tok: Token, ctx: ResolveContext) -> list[dict]:
    """Filtered + constrained option pool a ``@{uuid[#name][:expr][!null]}`` ref
    resolves against — catalog lookup, the ``:expr``/``!null`` sub-category
    filter, and chain constraints. Shared by ``_resolve_ref`` (single weighted
    pick) and the SP2b lone-ref multi-pick path.

    Returns ``[]`` (pushing the same ``unknown_ref`` /
    ``ref_subcategory_empty_pool`` warnings, and raising ``UnknownRefError`` in
    strict mode for an unknown ref) when there is nothing to pick. Does NOT
    apply the depth / cycle / surface guards — those stay in ``_resolve_ref``
    and the multi-pick caller.
    """
    uuid = tok.meta.get("uuid", "")
    module = ctx.get_module(uuid)
    if module is None:
        if ctx.strict:
            raise UnknownRefError(uuid)
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
        return []

    payload_dict = module.get("payload")
    if isinstance(payload_dict, dict):
        options = list(payload_dict.get("options", []))
    else:
        options = list(module.get("options", []))

    filter_expr = tok.meta.get("filter_expr")
    exclude_null = bool(tok.meta.get("exclude_null"))
    if (isinstance(filter_expr, str) and filter_expr.strip()) or exclude_null:
        ast = _parse_subcat(filter_expr) if isinstance(filter_expr, str) else None
        options = [
            o for o in options
            if isinstance(o, dict)
            and (
                (o.get("is_null") and not exclude_null)
                or (
                    not o.get("is_null")
                    and _subcat_matches(ast, set(o.get("sub_categories") or []))
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
                detail={
                    "uuid": uuid,
                    "filter_expr": filter_expr,
                    "exclude_null": exclude_null,
                },
                message=(
                    f"@{{{uuid}:{filter_expr or ''}"
                    f"{'!null' if exclude_null else ''}}} matched no options"
                ),
            )
            return []

    get_constraints = getattr(ctx, "get_constraints", None)
    get_picks = getattr(ctx, "get_picks", None)
    if callable(get_constraints) and callable(get_picks):
        constraints = get_constraints()
        if constraints:
            from engine.modules._constraints import (
                apply_constraints_for_target,
                warn_excludes_all,
            )
            # SP3: share the ctx-resident hit counter so a nested-ref
            # target occurrence counts toward the same first/next
            # coverage as direct top-level instances. `carrier_ctx` is
            # the identity of the carrier wildcard whose chosen option
            # value textually contains THIS `@{uuid}` ref — set on the
            # resolve frame by the enclosing wildcard handler (top-level
            # carrier) or by `_resolve_ref` (deeper carrier). A `pick`
            # selector's `nested` occurrence matches on it; first / next
            # / all ignore it. None when no carrier is set (a ref at the
            # surface root) — then `pick` simply won't cover.
            get_hits = getattr(ctx, "get_constraint_hits", None)
            hits = get_hits() if callable(get_hits) else {}
            get_carrier_ctx = getattr(ctx, "get_carrier_ctx", None)
            carrier_ctx = get_carrier_ctx() if callable(get_carrier_ctx) else None
            options, any_applied = apply_constraints_for_target(
                options, uuid, constraints, get_picks(), ctx.warnings,
                hits=hits, firing_uid=None, carrier_ctx=carrier_ctx,
            )
            if any_applied:
                warn_excludes_all(options, uuid, ctx.warnings)
    return options


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

    # Surface check — wildcard options AND derivation action values may host
    # `@{}` refs (both run resolve_text inside a seeded Context with the chain
    # constraint bucket threaded). combine + assembler stay gated.
    if ctx.surface not in ("wildcard", "derivation"):
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

    # Catalog lookup + `:expr`/`!null` filter + chain constraints, factored
    # into ref_option_pool (shared with the SP2b lone-ref multi-pick path).
    # The strict-unknown raise + the unknown / empty-pool warnings live there.
    options = ref_option_pool(tok, ctx)
    if not options:
        return ""

    chosen = _pick_weighted(options, ctx.rng)
    if chosen is None:
        return ""

    chosen_value = str(chosen.get("value", ""))
    if not chosen_value:
        return ""

    # Recursive resolve with depth+1, visited extended. This ref'd
    # wildcard is the carrier of any `@{X}` inside its OWN chosen option
    # value, so stamp (its uuid, the chosen option's id) on the frame for
    # the duration of the recursion, then restore the prior carrier. The
    # carrier_uid here is the library uuid (a ref'd wildcard has no row
    # `_uid`); a `pick` keyed on a top-level row uid won't match it —
    # that's the expected deeper-than-one-hop behaviour (positional
    # first/next/all cover deeper nesting). Mirrors the rng save/restore.
    nested_tokens = tokenize_text(chosen_value)
    get_carrier = getattr(ctx, "get_carrier", None)
    set_carrier = getattr(ctx, "set_carrier", None)
    if callable(get_carrier) and callable(set_carrier):
        saved_carrier = get_carrier()
        set_carrier(uuid, chosen.get("id"))
        try:
            return _resolve_tokens(
                nested_tokens, ctx, depth=depth + 1, visited=visited + (uuid,)
            )
        finally:
            set_carrier(*saved_carrier)
    return _resolve_tokens(nested_tokens, ctx, depth=depth + 1, visited=visited + (uuid,))
