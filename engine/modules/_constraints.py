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


def apply_constraints_for_target(
    options: list[dict[str, Any]],
    target_uuid: str,
    constraints: list[dict[str, Any]] | None,
    picks: dict[str, dict[str, Any]] | None,
    warnings: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Apply every constraint targeting ``target_uuid`` to ``options``.

    Returns a tuple ``(adjusted_options, any_applied)``. ``any_applied``
    is True if at least one constraint actually reweighted the pool —
    callers use it to decide whether to run the "excludes-all" check.

    Constraints are applied in registration order so multiple
    constraints on the same target compose multiplicatively (matches
    pre-extraction behavior in wildcard_handler).

    Each constraint warns + skips when its source wildcard hasn't been
    picked yet — caller code is responsible for ordering source
    wildcards before the target's roll. The warning gives the user a
    signal in WP_Debug instead of a silent no-op.
    """
    if not constraints or not isinstance(constraints, list):
        return options, False
    if not isinstance(picks, dict):
        picks = {}

    any_applied = False
    for c in constraints:
        if not isinstance(c, dict):
            continue
        if c.get("target_wildcard_id") != target_uuid:
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
