"""Wildcard module resolver — weighted RNG over options, syntax via resolve_text.

Each option's `value` may contain $var, @{uuid}, {a|b|c}, {N$$sep$$...}, and
escapes. After picking the option, resolve_text expands the syntax against
the runtime context.

Constraint integration: when the chain has registered constraints in
``ctx["__wp_constraints__"]`` whose ``target_wildcard_id`` matches the
current module's id, this handler applies the constraint matrix +
exception list to the option pool's weights before picking. The source
wildcard MUST have already been resolved earlier in the chain — picks
are recorded in ``ctx["__wp_picks__"][module_id]`` so a downstream
constraint-aware target can look them up. If a constraint fires
against a source that hasn't been picked yet (graph ordering bug), the
constraint is skipped and an ``unknown_constraint_source`` warning is
emitted.
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules._seed import derive_module_rng as _derive_module_rng
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text
from engine.syntax.subcat_filter import (
    matches as _subcat_matches,
)
from engine.syntax.subcat_filter import (
    parse as _parse_subcat,
)
from engine.syntax.subcat_filter import (
    validate_subcat_name,
)

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_MAX_IDENT_LEN = 64

# `_derive_module_rng` lifted to engine/modules/_seed.py so combine +
# fixed_values handlers share the same helper (Phase: combine v2 +
# syntax parity cycle). The private alias preserves the existing call
# site at line ~376 unchanged.


def _pick_weighted(options: list[dict[str, Any]], rng) -> dict[str, Any] | None:
    """Pick one option weighted by `weight`. Uses rng (no module-global random)."""
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


def _apply_constraint_to_options(
    options: list[dict[str, Any]],
    constraint: dict[str, Any],
    source_pick: dict[str, Any],
    adjustment_warnings: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Adjust option weights according to a single constraint, given the
    already-picked source option.

    Two layers, in order:
      1. Matrix lookup keyed by `(source.sub_category, target.sub_category)`,
         where an option's "sub_category" is its PRIMARY tag
         (`sub_categories[0]`, or None when untagged). SP1 stopgap — true
         multi-tag matrix matching (an option on N rows → multiply) is
         SP3. Bulk rule expressing "long hair allows positive moods" etc.
      2. Exception lookup keyed by the literal `(source.value, target.value)`
         pair. Overrides the matrix cell when present — narrower rule wins.

    Modes:
      - ``allow``   → no change to weight (factor honoured but typically 1).
      - ``exclude`` → weight set to 0 (option drops out of the pool).
      - ``boost``   → multiply weight by factor (expect factor > 1).
      - ``reduce``  → multiply weight by factor (expect factor < 1).

    Options not covered by either matrix or exception keep their
    original weight. Returns shallow-copied list — the input options
    array is never mutated, so the underlying snapshot stays clean
    across runs.
    """
    matrix = constraint.get("matrix") or {}
    exceptions = constraint.get("exceptions") or []
    src_value = str(source_pick.get("value", ""))
    # Primary tag = first of sub_categories (SP1 stopgap; SP3 multiplies).
    src_subs = source_pick.get("sub_categories") or []
    src_sub = src_subs[0] if src_subs else None

    # Index exceptions by (source_value, target_value) for O(1) lookup.
    # Empty string is a valid key — it's the null-option marker (a
    # wildcard option with `is_null: True` has `value: ""`). So
    # `{source: "rain", target: ""}` excludes the null option when the
    # source rolls "rain". The validator allows empty strings on these
    # fields for the same reason; only fully-missing keys (None on both
    # legacy + tier-2 names) are rejected upstream.
    exc_by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    for exc in exceptions:
        if not isinstance(exc, dict):
            continue
        s = exc.get("source")
        t = exc.get("target")
        if isinstance(s, str) and isinstance(t, str):
            exc_by_pair[(s, t)] = exc

    matrix_row = matrix.get(src_sub) if src_sub else None

    adjusted: list[dict[str, Any]] = []
    for opt in options:
        opt_value = str(opt.get("value", ""))
        opt_subs = opt.get("sub_categories") or []
        opt_sub = opt_subs[0] if opt_subs else None
        weight = float(opt.get("weight", 1))

        # Exception layer (specific value pair) wins over matrix layer.
        rule = exc_by_pair.get((src_value, opt_value))
        if rule is None and isinstance(matrix_row, dict) and opt_sub is not None:
            rule = matrix_row.get(opt_sub)

        if isinstance(rule, dict):
            mode = rule.get("mode")
            try:
                factor = float(rule.get("factor", 1.0))
            except (TypeError, ValueError):
                factor = 1.0
            if mode == "exclude":
                weight = 0.0
            elif mode == "boost" or mode == "reduce":
                weight = max(0.0, weight * factor)
            elif mode == "allow":
                # `allow` is a no-op weight-wise; surface a warning when
                # the SPA stored a non-1 factor on it because that's
                # almost certainly a user expecting weight*factor and
                # silently getting full weight.
                if factor != 1.0:
                    out_warns = adjustment_warnings if adjustment_warnings is not None else None
                    if out_warns is not None:
                        out_warns.append({
                            "type": "constraint_factor_ignored_on_allow",
                            "factor": factor,
                            "src_value": src_value,
                            "opt_value": opt_value,
                        })
            else:
                # Unknown mode — typo like "exlcude" / "alllow". Silent
                # no-op was the worst-of-both: weight unchanged + zero
                # signal that the rule was malformed. Bubble it up so
                # the caller can emit a `unknown_constraint_mode` warning.
                out_warns = adjustment_warnings if adjustment_warnings is not None else None
                if out_warns is not None:
                    out_warns.append({
                        "type": "unknown_constraint_mode",
                        "mode": mode,
                        "src_value": src_value,
                        "opt_value": opt_value,
                    })

        adjusted.append({**opt, "weight": weight})
    return adjusted


def _record_pick(ctx: Any, chosen: dict[str, Any]) -> None:
    """Stash the picked option dict in `ctx["__wp_picks__"][module_id]` so a
    downstream constraint-aware wildcard can look up its source's value +
    sub_categories. Keyed by the active module id (set by pipeline.py).
    """
    module_id = ctx.get("__wp_current_module_id__") if ctx is not None else None
    if not module_id:
        return
    bucket = ctx.setdefault("__wp_picks__", {})
    if isinstance(bucket, dict):
        bucket[module_id] = {
            "value": chosen.get("value"),
            "sub_categories": chosen.get("sub_categories", []),
            "id": chosen.get("id"),
        }


class WildcardHandler(ModuleHandler):
    type_id = "wildcard"

    @staticmethod
    def _apply_pool_filter(
        options: list[dict[str, Any]],
        expr: str,
        *,
        exclude_null: bool,
    ) -> list[dict[str, Any]]:
        """Narrow an option pool by a boolean sub-category expression.

        `expr` is parsed via the shared subcat_filter matcher and tested
        against each non-null option's tag set (`sub_categories`). Empty
        / whitespace `expr` ⇒ no tag filtering. The null option
        (`is_null`) is governed solely by `exclude_null`; the expression
        never applies to it (spec §3.4).
        """
        ast = _parse_subcat(expr) if isinstance(expr, str) else None
        out: list[dict[str, Any]] = []
        for o in options:
            if o.get("is_null"):
                if not exclude_null:
                    out.append(o)
                continue
            if _subcat_matches(ast, set(o.get("sub_categories") or [])):
                out.append(o)
        return out

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("wildcard payload must be an object")
        options = payload.get("options")
        if not isinstance(options, list):
            raise ValueError("wildcard payload.options must be a list")

        # Sub-category registry — the allowed tag names. Validated first
        # so each option's membership + tag_groups can be checked against
        # it. `validate_subcat_name` enforces the §3.6 name rules (single
        # token; no whitespace / boolean-grammar / ref chars; not a
        # reserved word incl. `null`).
        registry_list = payload.get("sub_categories", [])
        if not isinstance(registry_list, list):
            raise ValueError("wildcard payload.sub_categories must be a list")
        registry: set[str] = set()
        for i, sc in enumerate(registry_list):
            if not isinstance(sc, str):
                raise ValueError(
                    f"wildcard payload.sub_categories[{i}] must be a string"
                )
            name_err = validate_subcat_name(sc)
            if name_err:
                raise ValueError(
                    f"wildcard payload.sub_categories[{i}]: {name_err}"
                )
            registry.add(sc)

        # Optional UI-only grouping of registry tags into named axes. The
        # engine ignores it at resolve time; validate the shape, that
        # every member is a registry tag, and that a tag lives in at most
        # one group.
        tag_groups = payload.get("tag_groups")
        if tag_groups is not None:
            if not isinstance(tag_groups, dict):
                raise ValueError("wildcard payload.tag_groups must be an object")
            seen_grouped: set[str] = set()
            for gname, members in tag_groups.items():
                if not isinstance(gname, str) or not isinstance(members, list):
                    raise ValueError(
                        "wildcard payload.tag_groups entries must be "
                        "name -> string[]"
                    )
                for mem in members:
                    if mem not in registry:
                        raise ValueError(
                            f"wildcard payload.tag_groups[{gname!r}]: {mem!r} "
                            f"not in sub_categories registry"
                        )
                    if mem in seen_grouped:
                        raise ValueError(
                            f"wildcard payload.tag_groups: {mem!r} appears in "
                            f"more than one group"
                        )
                    seen_grouped.add(mem)

        seen_ids: set[str] = set()
        null_count = 0
        for i, opt in enumerate(options):
            if not isinstance(opt, dict):
                raise ValueError(f"wildcard payload.options[{i}] must be an object")
            # Option ids must be unique across the pool — `pinned_option_id`
            # lookup, `enabled_options` toggles, and `option_weights`
            # overrides all key by id, so dupes make those features
            # nondeterministic.
            opt_id = opt.get("id")
            if not isinstance(opt_id, str) or not opt_id:
                raise ValueError(
                    f"wildcard payload.options[{i}].id must be a string"
                )
            if opt_id in seen_ids:
                raise ValueError(
                    f"wildcard payload.options[{i}].id {opt_id!r} duplicates "
                    f"an earlier option id"
                )
            seen_ids.add(opt_id)
            value = opt.get("value", "")
            is_null = bool(opt.get("is_null"))
            if is_null:
                null_count += 1
                # Null option contract: value must be empty string, no
                # sub_category. The flag is the source of truth — see
                # docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md.
                if value != "":
                    raise ValueError(
                        f"wildcard payload.options[{i}] null option "
                        f"{opt_id!r} must have empty value (got {value!r})"
                    )
                null_subs = opt.get("sub_categories", [])
                if null_subs:
                    raise ValueError(
                        f"wildcard payload.options[{i}] null option "
                        f"{opt_id!r} must have no sub_categories (got "
                        f"{null_subs!r})"
                    )
            else:
                if not isinstance(value, str) or value == "":
                    raise ValueError(
                        f"wildcard payload.options[{i}].value must be a "
                        f"non-empty string (use is_null=True for the null option)"
                    )
            weight = opt.get("weight", 1)
            if not isinstance(weight, (int, float)) or isinstance(weight, bool):
                raise ValueError(
                    f"wildcard payload.options[{i}].weight must be a number"
                )
            if float(weight) < 0:
                raise ValueError(
                    f"wildcard payload.options[{i}].weight must not be negative"
                )
            subs = opt.get("sub_categories", [])
            if not isinstance(subs, list):
                raise ValueError(
                    f"wildcard payload.options[{i}].sub_categories must be a list"
                )
            for s in subs:
                if not isinstance(s, str):
                    raise ValueError(
                        f"wildcard payload.options[{i}].sub_categories must be "
                        f"strings"
                    )
                if s not in registry:
                    raise ValueError(
                        f"wildcard payload.options[{i}].sub_categories: {s!r} "
                        f"not in sub_categories registry"
                    )
        if null_count > 1:
            raise ValueError(
                f"wildcard payload may have at most one null option "
                f"(found {null_count})"
            )
        binding = payload.get("var_binding")
        if binding is not None:
            if not isinstance(binding, str):
                raise ValueError("wildcard payload.var_binding must be a string")
            # Empty string used to slip through (the old guard was
            # `if binding and not match`, which short-circuited on
            # falsy). Reject explicitly + bound length + reject the
            # `__dunder` prefix (collides with engine-internal key
            # convention — see engine/modules/types.py:strip_internals).
            if not binding:
                raise ValueError("wildcard payload.var_binding must not be empty")
            if len(binding) > _MAX_IDENT_LEN:
                raise ValueError(
                    f"wildcard payload.var_binding must be at most "
                    f"{_MAX_IDENT_LEN} chars (got {len(binding)})"
                )
            if binding.startswith("__"):
                raise ValueError(
                    "wildcard payload.var_binding must not start with '__' "
                    "(reserved for engine-internal keys)"
                )
            if not _IDENT_RE.match(binding):
                raise ValueError(
                    f"wildcard payload.var_binding {binding!r} is not a valid identifier"
                )

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        binding = instance.get("variable_binding") or payload.get("var_binding") or ""
        if not binding:
            return {}

        options: list[dict[str, Any]] = list(payload.get("options", []))

        # `pinned` mode short-circuits the RNG: always pick the option
        # whose id matches `pinned_option_id`. Falls through to random
        # (with a warning) if the pinned id can't be found — handles
        # the case where the user pinned an option that the library
        # has since removed. Honors enabled_options + weights normally
        # in every other mode.
        mode = instance.get("mode")
        if mode == "pinned":
            pinned_id = instance.get("pinned_option_id")
            pinned = next((o for o in options if o.get("id") == pinned_id), None)
            if pinned is not None:
                # Track the pinned pick the same way as a random pick —
                # downstream constraint-aware wildcards need source
                # info regardless of how the source resolved its option.
                _record_pick(ctx, pinned)
                value = str(pinned.get("value", ""))
                if not value:
                    return {binding: ""}
                resolve_ctx = build_resolve_ctx(ctx, surface="wildcard")
                return {binding: resolve_text(value, resolve_ctx)}
            # else: pinned target is missing — fall through to random.

        # `category_filter` narrows the option pool to entries whose tag
        # set (`sub_categories`) satisfies a boolean expression
        # (`and`/`or`/`not`/parens; comma=or). Empty / missing = no tag
        # filter. `exclude_null` is a separate flag: when true the null
        # option is dropped, otherwise it is an orthogonal "no-output"
        # slot that survives every filter (the expression never applies
        # to it). Untagged non-null options bypass the expression unless
        # a bare tag term excludes them (spec §3.4). See the shared
        # matcher in engine/syntax/subcat_filter.py.
        category_filter = instance.get("category_filter")
        exclude_null = bool(instance.get("exclude_null", False))
        if (isinstance(category_filter, str) and category_filter.strip()) or exclude_null:
            options = cls._apply_pool_filter(
                options,
                category_filter if isinstance(category_filter, str) else "",
                exclude_null=exclude_null,
            )

        enabled = instance.get("enabled_options")
        if enabled is not None:
            allowed = set(enabled)
            options = [o for o in options if o.get("id") in allowed]

        if not options:
            return {binding: ""}

        # Per-instance weight overrides — replaces (not multiplies) the
        # library weight when the option's id appears in the override
        # map. Missing/non-numeric overrides leave the library weight
        # untouched. Shallow-copy each option so we don't mutate the
        # underlying snapshot payload (which is shared across runs).
        weight_overrides = instance.get("option_weights")
        if isinstance(weight_overrides, dict) and weight_overrides:
            adjusted: list[dict[str, Any]] = []
            for o in options:
                oid = o.get("id")
                if oid in weight_overrides:
                    try:
                        new_weight = float(weight_overrides[oid])
                    except (TypeError, ValueError):
                        adjusted.append(o)
                        continue
                    o = {**o, "weight": new_weight}
                adjusted.append(o)
            options = adjusted

        # Constraint application — each constraint targeting THIS module
        # adjusts the option pool's weights based on what its source
        # wildcard already picked. Apply logic extracted to
        # `engine.modules._constraints` so the nested-`@{}` path in
        # `engine.syntax.resolve` shares the same implementation.
        from engine.modules._constraints import (
            apply_constraints_for_target,
            warn_excludes_all,
        )
        my_id = ctx.get("__wp_current_module_id__") if ctx is not None else None
        any_constraint_applied = False
        if my_id:
            constraints = ctx.get("__wp_constraints__") if ctx is not None else None
            picks = ctx.get("__wp_picks__") if ctx is not None else None
            # First-instance one-shot: pass the ctx-resident consumed
            # set so the apply_constraints helper marks fired
            # constraints + skips them on subsequent target instances.
            consumed = (
                ctx.setdefault("__wp_consumed_constraints__", set())
                if isinstance(ctx, dict) else None
            )
            options, any_constraint_applied = apply_constraints_for_target(
                options, my_id, constraints, picks, ctx["__wp_warnings__"],
                consumed=consumed,
            )
        if any_constraint_applied:
            warn_excludes_all(options, my_id or "", ctx["__wp_warnings__"])

        # Effective seed selection:
        #   - locked_seed when present → reproducible per-instance
        #   - chain seed (`__wp_node_seed__`) otherwise
        # Both paths feed the SAME `_derive_module_rng(seed, binding)`,
        # so locking with `locked_seed = chain_seed` reproduces the
        # unlocked pick exactly. This is the contract the lock UX
        # relies on: the user sees a roll, locks it, captures the
        # current chain seed, future runs reproduce the same roll.
        chain_seed = int(ctx.get("__wp_node_seed__", 0) or 0)
        locked_seed = instance.get("locked_seed")
        if locked_seed is not None:
            try:
                effective_seed = int(locked_seed)
            except (TypeError, ValueError):
                effective_seed = chain_seed
                locked_seed = None
        else:
            effective_seed = chain_seed
        rng = _derive_module_rng(effective_seed, binding)

        chosen = _pick_weighted(options, rng)
        if chosen is None:
            return {binding: ""}

        # Record this wildcard's pick so a downstream constraint-aware
        # wildcard can read it. Done BEFORE resolve_text so even an
        # empty-string-value pick is registered (matters if a
        # constraint exception keys on the literal empty pick value).
        _record_pick(ctx, chosen)

        # First-instance positional-claim failsafe. This wildcard may
        # CARRY a constraint's target via an `@{target}` ref in one of
        # its options. The pair badge already assigned the constraint to
        # this carrier, so once the carrier ROLLS — regardless of which
        # option won, including the `null` / empty-value option — it
        # claims the constraint so it doesn't spill onto a later target
        # instance. `claim_carrier_constraints` is a no-op when the
        # chosen option DID resolve the ref (the nested-resolve path
        # below already consumed it) or the source isn't picked yet.
        #
        # CRITICAL: must fire on EVERY roll path, including the
        # empty-value early return — a backdrop that rolls its `null`
        # option still "rolled" and must still claim its carried
        # constraints. The 2026-05-26 bug was calling this only after
        # resolve_text, so a null/empty pick skipped the claim and the
        # constraint either spilled or surfaced a misleading
        # never_applied warning.
        def _claim_carried() -> None:
            if ctx is None:
                return
            from engine.modules._constraints import claim_carrier_constraints
            claim_carrier_constraints(
                options,
                ctx.get("__wp_constraints__"),
                ctx.get("__wp_picks__"),
                ctx.get("__wp_consumed_constraints__"),
            )

        value = str(chosen.get("value", ""))
        if not value:
            # Empty / null pick — no ref to resolve, but the carrier
            # still rolled, so claim before returning.
            _claim_carried()
            return {binding: ""}

        # Swap `ctx['__wp_rng__']` to the per-module rng for the
        # duration of `resolve_text`. The swap is UNCONDITIONAL —
        # both locked and unlocked paths run nested resolution
        # against the per-module rng — because:
        #   - it's the only way locking can reproduce the unlocked
        #     pick (same effective_seed → same per-module rng →
        #     same pick AND same nested rolls).
        #   - it isolates wildcards from each other within one chain
        #     run: inline `{a|b|c}` picks no longer depend on
        #     module ordering / sibling picks.
        # `build_resolve_ctx` snapshots the rng reference at call
        # time, so it must be built INSIDE the swap.
        saved_rng = ctx.get("__wp_rng__")
        ctx["__wp_rng__"] = rng
        try:
            resolve_ctx = build_resolve_ctx(ctx, surface="wildcard")
            resolved = resolve_text(value, resolve_ctx)
        finally:
            ctx["__wp_rng__"] = saved_rng

        # Claim AFTER resolve_text so a chosen option that DID carry the
        # ref gets consumed-with-effect by the nested-resolve path
        # first; the claim then no-ops on it.
        _claim_carried()
        return {binding: resolved}
