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
from engine.syntax.resolve import pick_k_unique
from engine.syntax.subcat_filter import (
    matches as _subcat_matches,
)
from engine.syntax.subcat_filter import (
    parse as _parse_subcat,
)
from engine.syntax.subcat_filter import (
    validate_subcat_name,
)
from engine.syntax.types import ListVar

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_MAX_IDENT_LEN = 64

# `_derive_module_rng` lifted to engine/modules/_seed.py so combine +
# fixed_values handlers share the same helper (Phase: combine v2 +
# syntax parity cycle). The private alias preserves the existing call
# site at line ~376 unchanged.


def _coerce_pick_int(value: Any, default: int) -> int:
    """SP2a: coerce a pick-count field (`pick_min`/`pick_max`) to int, falling
    back to `default` on junk. The engine is reachable by hand-built and legacy
    instances, so a non-numeric value must degrade to single-pick rather than
    raise out of resolve() — mirrors the locked_seed coercion guard."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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
    already-picked source option(s).

    SP3: weight adjustment is delegated to
    :func:`engine.modules._constraint_math.combine_constraint_factor`, which
    multiplies one factor per matching matrix cell (an option on N source-tag
    rows multiplies N times — true multi-tag) across every source pick (true
    multi-pick). The exception layer (literal `(source_value, target_value)`
    pair) still overrides the matrix for that pick, and `exclude` is absorbing
    (factor 0 → weight 0, option drops out).

    `source_pick["picks"]` is the per-pick list (`[{value, tags}]`) recorded by
    `_record_pick` / `_record_pick_multi`. Legacy callers that hand-build a
    source dict without it fall back to a single synthetic pick from the
    top-level `value` + `sub_categories`.

    Returns a shallow-copied list — the input options array is never mutated,
    so the underlying snapshot stays clean across runs.

    `adjustment_warnings` (optional) collects editor-footgun warnings the
    caller forwards to the chain warning list:
      - ``constraint_factor_ignored_on_allow`` — a `mode: allow` cell carries a
        non-1 factor (user expects weight×factor, engine ignores it).
      - ``unknown_constraint_mode`` — a typo'd mode (`exlcude`/`alllow`) the
        combine fn treats as a no-op.
    These are diagnostic only; they never change the computed weight.
    """
    from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor

    matrix = constraint.get("matrix") or {}
    exceptions = constraint.get("exceptions") or []

    # Per-pick source list (SP3). Fall back to a single synthetic pick for
    # legacy callers that pass only the top-level value + sub_categories.
    picks = source_pick.get("picks")
    if not isinstance(picks, list):
        picks = [{
            "value": source_pick.get("value", ""),
            "tags": list(source_pick.get("sub_categories") or []),
        }]

    # Pre-scan for diagnostic warnings only. The combine fn intentionally
    # treats `allow` and unknown modes as factor 1.0 (no weight change), so it
    # can't surface them — mirror its (pick × option) rule selection here,
    # exception-pair winning over matrix cell, and warn where the selected rule
    # is an ignored-factor `allow` or an unrecognised mode.
    if adjustment_warnings is not None:
        _scan_constraint_warnings(
            picks, options, matrix, exceptions, adjustment_warnings,
        )

    adjusted: list[dict[str, Any]] = []
    for opt in options:
        option = {"value": opt.get("value", ""), "tags": opt.get("sub_categories") or []}
        f = combine_constraint_factor(picks, option, matrix, exceptions)
        weight = float(opt.get("weight", 1))
        weight = 0.0 if f is EXCLUDE else max(0.0, weight * float(f))
        adjusted.append({**opt, "weight": weight})
    return adjusted


_KNOWN_CONSTRAINT_MODES = frozenset({"allow", "exclude", "boost", "reduce"})


def _exc_pair_index(exceptions: list[Any]) -> dict[tuple[str, str], dict[str, Any]]:
    """Index exceptions by (source_value, target_value), mirroring the
    combine fn's key fallback (tier-2 `source_value`/`target_value` names,
    then legacy `source`/`target`). Empty string is a valid key — it's the
    null-option marker (`is_null` options carry `value: ""`)."""
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for exc in exceptions or []:
        if not isinstance(exc, dict):
            continue
        s = exc.get("source_value")
        if s is None:
            s = exc.get("source")
        t = exc.get("target_value")
        if t is None:
            t = exc.get("target")
        if isinstance(s, str) and isinstance(t, str):
            out[(s, t)] = exc
    return out


def _scan_constraint_warnings(
    picks: list[dict[str, Any]],
    options: list[dict[str, Any]],
    matrix: dict[str, Any],
    exceptions: list[Any],
    adjustment_warnings: list[dict[str, Any]],
) -> None:
    """Append `constraint_factor_ignored_on_allow` / `unknown_constraint_mode`
    diagnostics for the rules that fire (per pick × option). Selection order
    matches `combine_constraint_factor`: an exception on the literal value pair
    wins over a matrix cell, and only the matched rule is inspected."""
    exc_by_pair = _exc_pair_index(exceptions)
    for pick in picks:
        p_value = str(pick.get("value", ""))
        p_tags = pick.get("tags") or []
        for opt in options:
            opt_value = str(opt.get("value", ""))
            opt_tags = opt.get("sub_categories") or []

            exc = exc_by_pair.get((p_value, opt_value))
            if exc is not None:
                _warn_for_rule(exc, p_value, opt_value, adjustment_warnings)
                continue

            for s in p_tags:
                row = matrix.get(s)
                if not isinstance(row, dict):
                    continue
                for t in opt_tags:
                    rule = row.get(t)
                    if isinstance(rule, dict):
                        _warn_for_rule(rule, p_value, opt_value, adjustment_warnings)


def _warn_for_rule(
    rule: dict[str, Any],
    src_value: str,
    opt_value: str,
    adjustment_warnings: list[dict[str, Any]],
) -> None:
    mode = rule.get("mode")
    if mode == "allow":
        # `allow` is a weight no-op; a non-1 factor is almost certainly a
        # user expecting weight×factor and silently getting full weight.
        try:
            factor = float(rule.get("factor", 1.0))
        except (TypeError, ValueError):
            factor = 1.0
        if factor != 1.0:
            adjustment_warnings.append({
                "type": "constraint_factor_ignored_on_allow",
                "factor": factor,
                "src_value": src_value,
                "opt_value": opt_value,
            })
    elif mode not in _KNOWN_CONSTRAINT_MODES:
        # Typo like "exlcude" / "alllow". The combine fn no-ops it; bubble up
        # so the caller can surface `unknown_constraint_mode`.
        adjustment_warnings.append({
            "type": "unknown_constraint_mode",
            "mode": mode,
            "src_value": src_value,
            "opt_value": opt_value,
        })


def _file_pick_by_origin(
    ctx: Any,
    entry: dict[str, Any],
    bucket: dict[str, Any],
    module_id: Any,
) -> None:
    """Attach `entry` under `bucket[module_id]["by_origin"][origin]` when the
    active module carries a `bundle_origin` (stamped by pipeline.py). This is
    the per-instance source-pick view a constraint in the same bundle copy
    reads (task_5200c1fc); the top-level `bucket[module_id]` stays the
    last-writer-wins fallback. No-op when no origin is stamped, so a
    top-level / manual / legacy module's pick entry is byte-for-byte today's
    shape. The `by_origin` map is carried FORWARD across re-records of the
    same module_id so two origins writing the same library uuid each keep
    their own view (the 2nd record must not drop the 1st origin's bucket).
    """
    origin = ctx.get("__wp_current_module_bundle_origin__") if ctx is not None else None
    if not origin:
        return
    prev = bucket.get(module_id)
    by_origin = {}
    if isinstance(prev, dict) and isinstance(prev.get("by_origin"), dict):
        by_origin = dict(prev["by_origin"])
    by_origin[origin] = {k: v for k, v in entry.items() if k != "by_origin"}
    entry["by_origin"] = by_origin


def _record_pick(ctx: Any, chosen: dict[str, Any]) -> None:
    """Stash the picked option dict in `ctx["__wp_picks__"][module_id]` so a
    downstream constraint-aware wildcard can look up its source's value +
    sub_categories. Keyed by the active module id (set by pipeline.py).
    """
    # KNOWN COLLISION (task_5200c1fc): module_id is the LIBRARY uuid
    # (pipeline.py stamps __wp_current_module_id__ = library id). Two
    # instances of one library wildcard (bundle inserted twice, or the same
    # wildcard added twice) share this bucket key — the 2nd pick clobbers the
    # 1st, and every constraint sourcing that uuid reads the survivor. Fix =
    # key on the per-instance _uid + give constraints a source-INSTANCE bind.
    # Do NOT "fix" by regenerating ids on insert: that severs drift/refresh-
    # by-id lineage (see the remapBundleUuids dead-code note + task_5200c1fc).
    module_id = ctx.get("__wp_current_module_id__") if ctx is not None else None
    if not module_id:
        return
    bucket = ctx.setdefault("__wp_picks__", {})
    if isinstance(bucket, dict):
        entry = {
            "value": chosen.get("value"),
            "sub_categories": chosen.get("sub_categories", []),
            "id": chosen.get("id"),
            # SP3: per-pick list the combine fn reads. A single pick is a
            # one-element list so the multi-tag/multi-pick applier has a
            # uniform shape regardless of single- vs multi-select source.
            "picks": [{
                "value": chosen.get("value", ""),
                "tags": list(chosen.get("sub_categories") or []),
            }],
        }
        # Additive per-instance view (task_5200c1fc). When this wildcard
        # carries a `bundle_origin`, ALSO file the pick under
        # `by_origin[origin]` so a constraint in the SAME bundle copy can
        # read its own source instance instead of the last-writer survivor
        # at the top-level key. The top-level entry above is left as the
        # fallback bucket (unchanged shape) — anything reading it is
        # unaffected. Omitted entirely when no origin is stamped.
        _file_pick_by_origin(ctx, entry, bucket, module_id)
        bucket[module_id] = entry


def _record_pick_multi(ctx: Any, chosen_list: list[dict[str, Any]], sep: str) -> None:
    """Multi-select counterpart to `_record_pick` (SP2a). Stash the joined
    value + the individual picked values + the union of their sub-categories,
    so the debug Picks view can render the list. Single-pick records (via
    `_record_pick`) keep their original shape."""
    # Same library-uuid bucket collision as `_record_pick` (see task_5200c1fc).
    module_id = ctx.get("__wp_current_module_id__") if ctx is not None else None
    if not module_id:
        return
    bucket = ctx.setdefault("__wp_picks__", {})
    if not isinstance(bucket, dict):
        return
    values = [str(c.get("value", "")) for c in chosen_list]
    union: list[str] = []
    for c in chosen_list:
        for t in (c.get("sub_categories") or []):
            if t not in union:
                union.append(t)
    # SP3: per-pick list (value + that pick's own tags, NOT the union) so the
    # combine fn can apply the matrix per pick. The union above stays for the
    # debug Picks view; `picks` is what constraint application reads.
    per_pick = [
        {"value": str(c.get("value", "")), "tags": list(c.get("sub_categories") or [])}
        for c in chosen_list
    ]
    entry = {
        "value": sep.join(values),
        "values": values,
        "sub_categories": union,
        "id": chosen_list[0].get("id") if chosen_list else None,
        "picks": per_pick,
    }
    # Same per-instance view as `_record_pick` (task_5200c1fc).
    _file_pick_by_origin(ctx, entry, bucket, module_id)
    bucket[module_id] = entry


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
            # SP3 reach selector: thread the ctx-resident per-constraint
            # hit counter so each covering constraint re-weights this
            # firing target instance (no more one-shot / consumed-set).
            # `firing_uid` identifies THIS direct top-level instance for
            # the `pick` selector's occurrence match.
            hits = (
                ctx.setdefault("__wp_constraint_hits__", {})
                if isinstance(ctx, dict) else {}
            )
            firing_uid = (
                ctx.get("__wp_current_module_uid__")
                if isinstance(ctx, dict) else None
            )
            options, any_constraint_applied = apply_constraints_for_target(
                options, my_id, constraints, picks, ctx["__wp_warnings__"],
                hits=hits, firing_uid=firing_uid,
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
        if instance.get("seed_scope") == "hold":
            chain_seed = int(ctx.get("__wp_node_seed_hold__", ctx.get("__wp_node_seed__", 0)) or 0)
        else:
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

        # SP2a multi-select: a count range other than (1, 1) picks N options
        # without replacement and binds a ListVar. The null option is never in
        # the multi-pick pool (exclude_null is single-pick-only); "maybe
        # nothing" is min=0. (1, 1) falls through to the single-pick path
        # below unchanged — same RNG draws, so existing locked seeds reproduce.
        raw_min = _coerce_pick_int(instance.get("pick_min"), 1)
        raw_max = _coerce_pick_int(instance.get("pick_max"), raw_min)
        lo = max(0, min(raw_min, raw_max))
        hi = max(lo, raw_max)
        if not (lo == 1 and hi == 1):
            pool = [o for o in options if not o.get("is_null")]
            weights = [max(0.0, float(o.get("weight", 1))) for o in pool]
            pool_n = len(pool)
            independent = bool(instance.get("pick_independent", False))
            if independent:
                # SP2c: independent multi-pick draws WITH replacement (repeats
                # allowed), mirroring the inline `~` flag — so the count is the
                # requested range and is NOT clamped to the pool size.
                count = lo if lo == hi else lo + int(rng.random() * (hi - lo + 1))
                picks = [
                    p for p in (_pick_weighted(pool, rng) for _ in range(count))
                    if p is not None
                ]
            else:
                lo_c, hi_c = min(lo, pool_n), min(hi, pool_n)
                count = lo_c if lo_c == hi_c else lo_c + int(rng.random() * (hi_c - lo_c + 1))
                picks = pick_k_unique(pool, weights, count, rng)
            sep = instance.get("pick_separator")
            if not isinstance(sep, str):
                sep = ", "
            items: list[str] = []
            saved_rng_multi = ctx.get("__wp_rng__")
            ctx["__wp_rng__"] = rng
            try:
                multi_ctx = build_resolve_ctx(ctx, surface="wildcard")
                for opt in picks:
                    items.append(resolve_text(str(opt.get("value", "")), multi_ctx))
            finally:
                ctx["__wp_rng__"] = saved_rng_multi
            _record_pick_multi(ctx, picks, sep)
            return {binding: ListVar(items, sep)}

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
            # Empty / null pick — no ref to resolve.
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
            # SP3 nested-pick reach: THIS wildcard is the carrier of any
            # `@{T}` ref inside `value`. Stamp (its per-instance uid, the
            # chosen option's id) on the resolve frame so a constraint on
            # T whose `pick` selector lists this (carrier_uid, option_id)
            # nested occurrence matches. A `pick` keyed on a DEEPER
            # carrier won't match this top-level uid — that's by design
            # (only one-hop carriers are individually pickable). Set on
            # the freshly-built ctx (carrier defaults None); no restore
            # needed — resolve_ctx is scoped to this resolve_text call.
            set_carrier = getattr(resolve_ctx, "set_carrier", None)
            if callable(set_carrier):
                set_carrier(
                    ctx.get("__wp_current_module_uid__"), chosen.get("id"),
                )
            resolved = resolve_text(value, resolve_ctx)
        finally:
            ctx["__wp_rng__"] = saved_rng

        return {binding: resolved}
