"""Shared constraint application — used by wildcard_handler (chain-level
target wildcards) and engine.syntax.resolve._resolve_ref (nested-via-@{}
target wildcards).

Pre-2026-05 the constraint matrix only applied when the target wildcard
ran as a top-level module in the chain. Wildcards reached through
``@{uuid}`` refs inside another wildcard's option value silently
bypassed the matrix, defeating the whole point of constraints in any
composed pipeline (outfit-set wildcards, palette reuse, etc.). This
module pulls the apply logic out of wildcard_handler so both surfaces
share one implementation.

The helper takes raw primitives (options list, target uuid, constraints
bucket, picks bucket, warnings list) so it can be called from any
context that has access to those — full pipeline ctx dict (wildcard
handler) or narrow ResolveContext-style accessors (ref resolver).
"""
from __future__ import annotations

from typing import Any

from engine.modules.wildcard_handler import _apply_constraint_to_options


def _push_constraint_warning(
    warnings: list[dict[str, Any]],
    *,
    type_: str,
    target_uuid: str,
    detail: dict[str, Any],
) -> None:
    """Mirror the warning shape used elsewhere in the engine so the
    debug viewer can render it uniformly."""
    warnings.append({
        "type": type_,
        "severity": "warn",
        "module_id": target_uuid,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": detail,
        "message": (
            f"constraint source not yet picked: {detail.get('source_wildcard_id')!r}"
            if type_ == "unknown_constraint_source"
            else f"constraint warning: {detail!r}"
        ),
    })


def _occurrence_matches(pick_entries, firing_uid, carrier_ctx) -> bool:
    """True when an explicit ``pick`` reach selector covers THIS firing
    target occurrence.

    Two occurrence kinds:
      - ``direct`` — a top-level wildcard instance. Matched by its
        per-instance uid (``firing_uid``). ``carrier_ctx`` is ``None``
        for these (the wildcard handler fires them directly).
      - ``nested`` — a ``@{target}`` ref resolved inside a carrier
        wildcard's chosen option. Matched by (carrier_uid, option_id).
        ``carrier_ctx`` carries those, threaded by the nested-resolve
        path (``engine.syntax.resolve``). The direct-firing wildcard
        handler passes ``carrier_ctx=None`` (it fires top-level
        instances, not nested refs), so the two kinds never cross-match.
    """
    for p in pick_entries:
        if not isinstance(p, dict):
            continue
        if carrier_ctx is None:
            if p.get("kind") == "direct" and p.get("uid") == firing_uid:
                return True
        else:
            if (
                p.get("kind") == "nested"
                and p.get("carrier_uid") == carrier_ctx.get("carrier_uid")
                and p.get("option_id") == carrier_ctx.get("option_id")
            ):
                return True
    return False


def _select_source_pick(
    picks: dict[str, dict[str, Any]],
    src_id: Any,
    constraint: dict[str, Any],
) -> dict[str, Any] | None:
    """Resolve the source pick a constraint should re-weight against.

    Selection rule (task_5200c1fc — source-instance binding):
      1. Look up the top-level entry `picks[src_id]` (today's bucket, the
         last-writer-wins survivor when two instances share a library uuid).
      2. If the constraint carries a `bundle_origin` AND that entry has a
         `by_origin[origin]` view, return that view — the source instance in
         the SAME bundle copy as this constraint.
      3. Otherwise return the top-level entry as-is = TODAY'S behavior,
         exactly. Covers: a no-bundle constraint, a constraint inside a
         bundle whose source is OUTSIDE the bundle, and every legacy
         workflow. This exact-fallback is what makes the change safe.

    DOCUMENTED LIMITATION (task_5200c1fc): the same library wildcard added
    MANUALLY twice OUTSIDE any bundle shares no `bundle_origin`, so both
    manual instances land in the same top-level bucket and the constraint
    falls back to last-writer-wins. The constraint payload genuinely does
    not encode WHICH manual instance the user meant, so the design declines
    to guess rather than guessing wrong. This is a principled residual, not
    a gap; an explicit stored `source_uid` binding (Option 2 in the design)
    can be layered on later with precedence explicit > bundle-scope >
    fallback, foreclosing nothing.
    """
    if not isinstance(src_id, str):
        return None
    top = picks.get(src_id)
    if not isinstance(top, dict):
        return None
    origin = constraint.get("__constraint_bundle_origin__")
    if origin:
        by_origin = top.get("by_origin")
        if isinstance(by_origin, dict):
            scoped = by_origin.get(origin)
            if isinstance(scoped, dict):
                return scoped
    return top


def apply_constraints_for_target(
    options: list[dict[str, Any]],
    target_uuid: str,
    constraints: list[dict[str, Any]] | None,
    picks: dict[str, dict[str, Any]] | None,
    warnings: list[dict[str, Any]],
    *,
    consumed=None,
    hits=None,
    firing_uid=None,
    carrier_ctx=None,
) -> tuple[list[dict[str, Any]], bool]:
    """Apply EVERY constraint whose reach selector covers this firing
    target instance, combined sequentially.

    Returns ``(adjusted_options, any_applied)``. ``any_applied`` is True
    iff at least one constraint actually fired — callers use it to
    decide whether to run the excludes-all check.

    **Reach selector (SP3).** Each constraint carries
    ``target_select = {mode, count?, picks?}`` (default ``{mode: "all"}``).
    On every firing target instance the per-constraint hit counter
    ``hits[cid]`` increments; the selector then decides coverage:
      - ``all`` — covers every instance (re-weights every downstream
        target occurrence).
      - ``first`` — covers only the 1st (``n == 1``).
      - ``next`` — covers the first ``count`` (``n <= count``).
      - ``pick`` — covers the explicitly-listed occurrences
        (``_occurrence_matches``).
    Multiple covering constraints stack: their factors multiply in
    registration order and ``exclude`` is absorbing. This replaces the
    pre-SP3 one-shot / consumed-set model.

    Reach is downstream-relative by construction: a constraint only
    appears in ``ctx["__wp_constraints__"]`` after its own module ran,
    so target occurrences upstream of it never see it.

    ``hits`` is the ctx-resident ``__wp_constraint_hits__`` dict; the
    caller threads it from ctx so first/next counters persist across the
    run (direct + nested encounters share one counter). ``consumed`` is
    accepted but ignored — kept so legacy callers don't break.

    Each constraint warns + skips when its source wildcard hasn't been
    picked yet — caller code is responsible for ordering source
    wildcards before the target's roll. The warning gives the user a
    signal in WP_Debug instead of a silent no-op.
    """
    if not constraints or not isinstance(constraints, list):
        return options, False
    if not isinstance(picks, dict):
        picks = {}
    if hits is None:
        hits = {}

    any_applied = False
    for c in constraints:
        if not isinstance(c, dict) or c.get("target_wildcard_id") != target_uuid:
            continue
        cid = c.get("__constraint_module_id__")
        src_id = c.get("source_wildcard_id")
        src_pick = _select_source_pick(picks, src_id, c)
        if not isinstance(src_pick, dict):
            _push_constraint_warning(
                warnings,
                type_="unknown_constraint_source",
                target_uuid=target_uuid,
                detail={
                    "source_wildcard_id": src_id,
                    "target_wildcard_id": target_uuid,
                    "hint": (
                        "source must be picked before target — check chain order"
                    ),
                },
            )
            continue
        if cid is not None:
            hits[cid] = hits.get(cid, 0) + 1
        n = hits.get(cid, 1)
        sel = c.get("target_select") or {"mode": "all"}
        mode = sel.get("mode", "all")
        if mode == "first":
            covered = n == 1
        elif mode == "next":
            try:
                cnt = int(sel.get("count", 1))
            except (TypeError, ValueError):
                cnt = 1
            covered = n <= cnt
        elif mode == "pick":
            covered = _occurrence_matches(
                sel.get("picks") or [], firing_uid, carrier_ctx
            )
        else:
            covered = True
        if not covered:
            continue
        adjust_warnings: list[dict[str, Any]] = []
        options = _apply_constraint_to_options(
            options, c, src_pick, adjust_warnings,
        )
        any_applied = True
        for w in adjust_warnings:
            _push_constraint_warning(
                warnings,
                type_=w.get("type", "unknown_constraint_mode"),
                target_uuid=target_uuid,
                detail={
                    **{k: v for k, v in w.items() if k != "type"},
                    "source_wildcard_id": src_id,
                    "target_wildcard_id": target_uuid,
                },
            )
    return options, any_applied


def warn_excludes_all(
    options: list[dict[str, Any]],
    target_uuid: str,
    warnings: list[dict[str, Any]],
) -> None:
    """Emit the ``constraint_excludes_all_options`` warning when post-
    application weights sum to zero. ``_pick_weighted`` falls back to
    ``options[0]`` silently — without this warning the user sees the
    same option forever with no signal that constraints over-narrowed
    the pool.

    Call AFTER ``apply_constraints_for_target`` returned ``any_applied``.
    """
    if not options:
        return
    total = sum(max(0.0, float(o.get("weight", 1))) for o in options)
    if total <= 0:
        _push_constraint_warning(
            warnings,
            type_="constraint_excludes_all_options",
            target_uuid=target_uuid,
            detail={
                "target_wildcard_id": target_uuid,
                "hint": "every option was excluded; falling back to options[0]",
            },
        )
