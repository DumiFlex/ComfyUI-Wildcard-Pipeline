"""Sweep mode for WP_ContextLoop: every combination of chosen wildcards.

A sweep axis names one downstream wildcard instance (by its per-instance
`_uid`) and the option ids to walk. The loop runs the cartesian product of
the axes, one frame per combination, capped at `limit`. Each frame carries a
`{uid: option_id}` pin map in `__wp_pin_overrides__`; the pipeline turns a
matching wildcard instance into a `pinned` one for that frame (see
`apply_pin_override`), so the existing pinned path does the picking.

Ordering is row-major: the LAST axis changes fastest, so a two-axis sweep
reads like a grid (row = first axis, column = second).

Pure Python, no ComfyUI imports.
"""

from __future__ import annotations

import itertools
from typing import Any

PIN_KEY = "__wp_pin_overrides__"
HOLD_KEY = "__wp_sweep_hold__"

DEFAULT_LIMIT = 64
MAX_LIMIT = 999


def parse_sweep(raw: object) -> dict[str, Any]:
    """Recovery-friendly parse of the loop config's `sweep` block.

    Axes without a uid or without any option ids are dropped; a uid listed
    twice keeps its first axis; option ids are deduped in order. Mirrors
    `parseSweep` in `src/components/context-loop/types.ts`.
    """
    out: dict[str, Any] = {
        "enabled": False,
        "limit": DEFAULT_LIMIT,
        "hold_others": True,
        "axes": [],
    }
    if not isinstance(raw, dict):
        return out
    out["enabled"] = raw.get("enabled") is True
    limit = raw.get("limit")
    if isinstance(limit, int) and not isinstance(limit, bool):
        out["limit"] = min(MAX_LIMIT, max(1, limit))
    hold = raw.get("hold_others")
    if isinstance(hold, bool):
        out["hold_others"] = hold
    axes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for axis in raw.get("axes") or []:
        if not isinstance(axis, dict):
            continue
        uid = axis.get("uid")
        if not isinstance(uid, str) or not uid or uid in seen:
            continue
        ids: list[str] = []
        for oid in axis.get("option_ids") or []:
            if isinstance(oid, str) and oid and oid not in ids:
                ids.append(oid)
        # An axis with nothing ticked is kept (the user cleared it to pick
        # a few by hand) but sweeps nothing: see `live_axes`.
        seen.add(uid)
        clean: dict[str, Any] = {"uid": uid, "option_ids": ids}
        label = axis.get("label")
        if isinstance(label, str) and label:
            clean["label"] = label
        axes.append(clean)
    out["axes"] = axes
    return out


def live_axes(axes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The axes with at least one option ticked; only these sweep."""
    return [a for a in axes if a["option_ids"]]


def sweep_total(axes: list[dict[str, Any]]) -> int:
    """Number of combinations before the limit (1 for no axes)."""
    total = 1
    for axis in live_axes(axes):
        total *= len(axis["option_ids"])
    return total


def sweep_frames(axes: list[dict[str, Any]], limit: int) -> list[dict[str, str]]:
    """The first `limit` combinations as `{uid: option_id}` pin maps."""
    axes = live_axes(axes)
    if not axes:
        return []
    uids = [a["uid"] for a in axes]
    combos = itertools.product(*(a["option_ids"] for a in axes))
    capped = itertools.islice(combos, max(1, limit))
    return [dict(zip(uids, combo, strict=True)) for combo in capped]


def apply_pin_override(
    snapshot: dict[str, Any], module_uid: str, ctx: dict[str, Any],
) -> dict[str, Any]:
    """Return `snapshot` with a swept wildcard pinned to this frame's option.

    Only wildcards are pinned; the pin rides the existing `pinned` mode so
    axes still roll and the pick is recorded for downstream constraints.
    Returns a shallow copy rather than editing in place, because a snapshot
    can be the caller's module dict itself (`coerce_legacy_module` passes
    already-coerced modules through).
    """
    pins = ctx.get(PIN_KEY)
    if not isinstance(pins, dict) or not module_uid or module_uid not in pins:
        return snapshot
    if snapshot.get("type") != "wildcard":
        return snapshot
    inst = snapshot.get("instance")
    return {
        **snapshot,
        "instance": {
            **(inst if isinstance(inst, dict) else {}),
            "mode": "pinned",
            "pinned_option_id": pins[module_uid],
        },
    }
