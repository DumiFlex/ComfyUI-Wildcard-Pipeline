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
      1. Matrix lookup keyed by `(source.sub_category, target.sub_category)`.
         Bulk rule expressing "long hair allows positive moods" etc.
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
    src_sub = source_pick.get("sub_category")

    # Index exceptions by (source_value, target_value) for O(1) lookup.
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
        opt_sub = opt.get("sub_category")
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
    sub_category. Keyed by the active module id (set by pipeline.py).
    """
    module_id = ctx.get("__wp_current_module_id__") if ctx is not None else None
    if not module_id:
        return
    bucket = ctx.setdefault("__wp_picks__", {})
    if isinstance(bucket, dict):
        bucket[module_id] = {
            "value": chosen.get("value"),
            "sub_category": chosen.get("sub_category"),
            "id": chosen.get("id"),
        }


class WildcardHandler(ModuleHandler):
    type_id = "wildcard"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("wildcard payload must be an object")
        options = payload.get("options")
        if not isinstance(options, list):
            raise ValueError("wildcard payload.options must be a list")
        seen_ids: set[str] = set()
        for i, opt in enumerate(options):
            if not isinstance(opt, dict):
                raise ValueError(f"wildcard payload.options[{i}] must be an object")
            # Option ids must be unique across the pool — `pinned_option_id`
            # lookup, `enabled_options` toggles, and `option_weights`
            # overrides all key by id, so dupes make those features
            # nondeterministic.
            opt_id = opt.get("id")
            if isinstance(opt_id, str):
                if opt_id in seen_ids:
                    raise ValueError(
                        f"wildcard payload.options[{i}].id {opt_id!r} duplicates "
                        f"an earlier option id"
                    )
                seen_ids.add(opt_id)
            value = opt.get("value", "")
            if not isinstance(value, str):
                raise ValueError(
                    f"wildcard payload.options[{i}].value must be a string"
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
            sub_cat = opt.get("sub_category")
            if sub_cat is not None and not isinstance(sub_cat, str):
                raise ValueError(
                    f"wildcard payload.options[{i}].sub_category must be a string"
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
        sub_categories = payload.get("sub_categories", [])
        if not isinstance(sub_categories, list):
            raise ValueError("wildcard payload.sub_categories must be a list")
        for i, sc in enumerate(sub_categories):
            if not isinstance(sc, str):
                raise ValueError(
                    f"wildcard payload.sub_categories[{i}] must be a string"
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

        # `category_filter` narrows the option pool to entries whose
        # `sub_category` is in the chosen list. Empty list / None = no
        # filter (all sub-categories eligible). Options with a `None`
        # / missing sub_category are excluded by an explicit filter
        # (they're "unsorted" and the user opted into a curated set).
        category_filter = instance.get("category_filter")
        if isinstance(category_filter, list) and category_filter:
            allowed_cats = set(category_filter)
            options = [
                o for o in options
                if o.get("sub_category") in allowed_cats
            ]

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
            options, any_constraint_applied = apply_constraints_for_target(
                options, my_id, constraints, picks, ctx["__wp_warnings__"],
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

        value = str(chosen.get("value", ""))
        if not value:
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
        return {binding: resolved}
