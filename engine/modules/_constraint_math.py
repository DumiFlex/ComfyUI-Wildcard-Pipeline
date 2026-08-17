"""Pure constraint re-weight math (SP3). No engine/ctx imports — testable bare.

One multiply operator at three levels: across an option's matching matrix
cells (multi-tag), across source picks (multi-pick), and — by the caller —
across constraints. `exclude` (factor 0) is the absorbing element.

**One exception, added 2026-08 (tag axes).** Tags belonging to a source group
the wildcard declared `accepts` are ALTERNATIVES the option offers, not
statements that are all true at once. Those fold with `max`, so one sibling's
`exclude` cannot speak for the rest. Everything else still multiplies, and the
axis path is unreachable unless the caller passes `axis_kinds` — so a payload
that predates the feature folds byte-identically.
"""
from __future__ import annotations

from typing import Any


class _ExcludeSentinel:
    """Absorbing zero: the option drops out of the pool entirely.

    A distinct class rather than a bare ``object()`` so a type checker can
    narrow ``float | _ExcludeSentinel`` after an isinstance test. With the bare
    sentinel every ``factor *= r`` was unprovable, because ``is EXCLUDE`` does
    not narrow an ``object``.
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return "EXCLUDE"


EXCLUDE = _ExcludeSentinel()  # sentinel: option drops out of the pool

_Factor = float | _ExcludeSentinel


def _apply_rule(rule: dict[str, Any]) -> _Factor:
    mode = rule.get("mode")
    if mode == "exclude":
        return EXCLUDE
    if mode in ("boost", "reduce"):
        try:
            return max(0.0, float(rule.get("factor", 1.0)))
        except (TypeError, ValueError):
            return 1.0
    return 1.0  # allow / unknown -> no weight change


def _cell_factor(
    matrix: dict[str, Any], source_tag: str, opt_tags: list[str]
) -> _Factor:
    """Fold one source tag against every tag on the option.

    Product, because an option sitting on several rows of the same source tag
    is genuinely several separate statements about it. EXCLUDE is absorbing.
    """
    factor = 1.0
    row = matrix.get(source_tag)
    if not isinstance(row, dict):
        return factor
    for t in opt_tags:
        rule = row.get(t)
        if isinstance(rule, dict):
            r = _apply_rule(rule)
            if isinstance(r, _ExcludeSentinel):
                return EXCLUDE
            factor *= r
    return factor


def combine_constraint_factor(
    source_picks: list[dict[str, Any]] | None,
    option: dict[str, Any],
    matrix: dict[str, Any] | None,
    exceptions: list[Any] | None,
    axis_kinds: dict[str, str] | None = None,
) -> _Factor:
    matrix = matrix or {}
    axis_kinds = axis_kinds or {}
    exc_by_pair: dict[tuple[str, str], dict] = {}
    for e in (exceptions or []):
        if not isinstance(e, dict):
            continue
        s = e.get("source_value")
        if s is None:
            s = e.get("source")
        t = e.get("target_value")
        if t is None:
            t = e.get("target")
        if isinstance(s, str) and isinstance(t, str):
            exc_by_pair[(s, t)] = e
    opt_value = str(option.get("value", ""))
    opt_tags = option.get("tags") or []
    factor = 1.0
    for pick in (source_picks or []):
        p_value = str(pick.get("value", ""))
        p_tags = pick.get("tags") or []
        exc = exc_by_pair.get((p_value, opt_value))
        if exc is not None:
            r = _apply_rule(exc)
            if isinstance(r, _ExcludeSentinel):
                return EXCLUDE
            factor *= r
            continue

        # Partition this pick's tags: those inside an `accepts` axis fold with
        # max, the rest keep multiplying. A pick only carries `axes` when the
        # source wildcard declared the group `accepts`, and `axis_kinds` gates
        # it a second time, so a legacy pick takes the flat path untouched.
        pick_axes = pick.get("axes") or {}
        accepts: dict[str, list[str]] = {}
        claimed: set[str] = set()
        for axis, members in pick_axes.items():
            if axis_kinds.get(axis) != "accepts":
                continue
            in_axis = [t for t in p_tags if t in (members or [])]
            if in_axis:
                accepts[axis] = in_axis
                claimed.update(in_axis)

        for s in p_tags:
            if s in claimed:
                continue
            r = _cell_factor(matrix, s, opt_tags)
            if isinstance(r, _ExcludeSentinel):
                return EXCLUDE
            factor *= r

        for members in accepts.values():
            best = 0.0
            for s in members:
                r = _cell_factor(matrix, s, opt_tags)
                # One member's EXCLUDE is that member declining, not the axis
                # declining — it contributes 0 to the max and the siblings
                # still get their say.
                best = max(best, 0.0 if isinstance(r, _ExcludeSentinel) else r)
            # Every alternative the option offered was excluded, so the option
            # really does drop out.
            if best <= 0.0:
                return EXCLUDE
            factor *= best
    return factor
