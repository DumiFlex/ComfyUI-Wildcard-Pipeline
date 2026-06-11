"""Pure constraint re-weight math (SP3). No engine/ctx imports — testable bare.

One multiply operator at three levels: across an option's matching matrix
cells (multi-tag), across source picks (multi-pick), and — by the caller —
across constraints. `exclude` (factor 0) is the absorbing element.
"""
from __future__ import annotations

from typing import Any

EXCLUDE = object()  # sentinel: option drops out of the pool

def _apply_rule(rule: dict[str, Any]):
    mode = rule.get("mode")
    if mode == "exclude":
        return EXCLUDE
    if mode in ("boost", "reduce"):
        try:
            return max(0.0, float(rule.get("factor", 1.0)))
        except (TypeError, ValueError):
            return 1.0
    return 1.0  # allow / unknown -> no weight change

def combine_constraint_factor(source_picks, option, matrix, exceptions):
    matrix = matrix or {}
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
            if r is EXCLUDE:
                return EXCLUDE
            factor *= r
            continue
        for s in p_tags:
            row = matrix.get(s)
            if not isinstance(row, dict):
                continue
            for t in opt_tags:
                rule = row.get(t)
                if isinstance(rule, dict):
                    r = _apply_rule(rule)
                    if r is EXCLUDE:
                        return EXCLUDE
                    factor *= r
    return factor
