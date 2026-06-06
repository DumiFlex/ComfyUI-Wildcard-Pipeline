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

import re
from typing import Any

from engine.modules.wildcard_handler import _apply_constraint_to_options

# Mirror of `engine.syntax.tokenize._REF_RE` (kept local to avoid
# importing a private symbol across the module boundary). Captures the
# 8-hex uuid; the optional `#name` / `:expr` / `!null` segments are skipped.
_REF_RE = re.compile(
    r"@\{([0-9a-f]{8})(?:#[^#:}@{!]*)?(?::[^}!]*)?(?:![^}]*)?\}"
)


def claim_carrier_constraints(
    options: list[dict[str, Any]],
    constraints: list[dict[str, Any]] | None,
    picks: dict[str, dict[str, Any]] | None,
    consumed: set[str] | None,
) -> None:
    """First-instance positional-claim failsafe (2026-05-26).

    After a wildcard rolls + resolves its chosen option, any *unconsumed*
    constraint whose target this wildcard CARRIES — i.e. has an
    ``@{target}`` ref in ANY of its options, not just the chosen one — is
    consumed-as-skipped, provided the constraint's source has already
    been picked.

    Why: the pair badge assigns a constraint to the FIRST downstream
    wildcard that could host its target (direct instance OR nested-ref
    carrier). Without this failsafe the runtime only consumed a
    constraint when the target *actually* resolved, so a carrier whose
    chosen option happened to omit the ref let the constraint "spill"
    onto a later target instance — contradicting the badge and
    surprising the user. Claiming here binds the constraint to the
    carrier positionally: if the carrier's roll skips the ref, the
    constraint is spent (no spill) and no never_applied warning fires
    for it (the carrier did roll — it just didn't use the ref).

    No-op cases:
      - chosen option DID resolve the ref → the nested-resolve path
        already consumed the constraint; the ``cid in consumed`` guard
        skips it here.
      - source not yet picked → don't claim (matches the direct-target
        apply path, which also defers + warns rather than consuming an
        un-appliable constraint). Lets it potentially fire once the
        source is available later in the chain.
    """
    if not constraints or not isinstance(constraints, list):
        return
    if consumed is None:
        return
    if not isinstance(picks, dict):
        picks = {}
    carried: set[str] = set()
    for opt in options:
        val = opt.get("value")
        if isinstance(val, str):
            for m in _REF_RE.finditer(val):
                carried.add(m.group(1))
    if not carried:
        return
    # Claim at most ONE constraint per carried target — the first
    # unconsumed one in registration order. A carrier hosts a single
    # nested resolution per target, so it consumes a single constraint
    # for it (matching `apply_constraints_for_target`, which also fires
    # one per call). Claiming ALL would let a carrier swallow an entire
    # family of same-target constraints, starving a later direct target
    # instance that the pair badge assigns to constraint #2.
    claimed_targets: set[str] = set()
    for c in constraints:
        if not isinstance(c, dict):
            continue
        tgt = c.get("target_wildcard_id")
        if tgt not in carried or tgt in claimed_targets:
            continue
        cid = c.get("__constraint_module_id__")
        if cid is None or cid in consumed:
            continue
        src_id = c.get("source_wildcard_id")
        src_pick = picks.get(src_id) if isinstance(src_id, str) else None
        if not isinstance(src_pick, dict):
            continue
        consumed.add(cid)
        claimed_targets.add(tgt)


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


def apply_constraints_for_target(
    options: list[dict[str, Any]],
    target_uuid: str,
    constraints: list[dict[str, Any]] | None,
    picks: dict[str, dict[str, Any]] | None,
    warnings: list[dict[str, Any]],
    *,
    consumed: set[str] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Apply the FIRST unconsumed constraint targeting ``target_uuid``.

    Returns ``(adjusted_options, any_applied)``. ``any_applied`` is True
    iff a constraint actually fired — callers use it to decide whether
    to run the excludes-all check.

    **One-shot semantic (2026-05-24 first-instance redesign).** Each
    constraint module is a single ammo round: it fires on the first
    downstream target wildcard instance, gets marked consumed via its
    ``__constraint_module_id__`` key, and is skipped on subsequent
    target instances. A second target instance later in the chain
    claims the NEXT unconsumed constraint, not the same one again.

    Constraints are walked in registration (chain) order so the first
    unconsumed match wins. After applying, the function **breaks** out
    of the loop — exactly one constraint application per call.

    ``consumed`` is the ctx-resident ``__wp_consumed_constraints__``
    set; the caller is expected to thread it from ctx. ``None`` is
    accepted only by legacy test paths that pre-date the consume model.

    Each constraint warns + skips when its source wildcard hasn't been
    picked yet — caller code is responsible for ordering source
    wildcards before the target's roll. The warning gives the user a
    signal in WP_Debug instead of a silent no-op.

    See docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md.
    """
    if not constraints or not isinstance(constraints, list):
        return options, False
    if not isinstance(picks, dict):
        picks = {}
    if consumed is None:
        consumed = set()

    any_applied = False
    for c in constraints:
        if not isinstance(c, dict):
            continue
        if c.get("target_wildcard_id") != target_uuid:
            continue
        cid = c.get("__constraint_module_id__")
        if cid is not None and cid in consumed:
            continue
        src_id = c.get("source_wildcard_id")
        src_pick = picks.get(src_id) if isinstance(src_id, str) else None
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
        adjustment_warnings: list[dict[str, Any]] = []
        options = _apply_constraint_to_options(
            options, c, src_pick, adjustment_warnings,
        )
        if cid is not None:
            consumed.add(cid)
        any_applied = True
        for w in adjustment_warnings:
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
        # Key change for first-instance semantic: one constraint per
        # target-instance call. Subsequent target instances re-enter
        # this function and pick up the NEXT unconsumed constraint.
        break

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
