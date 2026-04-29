"""Wildcard module resolver — weighted RNG over options, syntax via resolve_text.

Each option's `value` may contain $var, @{uuid}, {a|b|c}, {N$$sep$$...}, and
escapes. After picking the option, resolve_text expands the syntax against
the runtime context.
"""
from __future__ import annotations

import hashlib
import random
from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text


def _derive_module_rng(seed: int, binding: str) -> random.Random:
    """Per-module RNG derived from (seed, binding).

    Used for BOTH locked and unlocked picks — applying the same
    derivation either way is what lets lock capture the visible
    roll: locking with `locked_seed = chain_seed` reproduces the
    unlocked pick exactly because both paths derive from
    `sha256(chain_seed:binding)`. With a raw `random.Random(seed)`
    in either branch, the streams diverge and the lock would
    produce a different pick than the user just saw.

    Hashing also de-couples module picks within a single chain
    seed: two wildcards binding different vars get independent
    streams, so adding/removing modules upstream doesn't shift
    the picks of the surviving ones.
    """
    digest = hashlib.sha256(f"{int(seed)}:{binding}".encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


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


class WildcardHandler(ModuleHandler):
    type_id = "wildcard"

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
