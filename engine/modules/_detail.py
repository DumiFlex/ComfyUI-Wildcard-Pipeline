"""Per-module run detail for the WP Debug node.

A run opts in by setting ``ctx["__wp_explain__"] = True`` (the canvas Context
node does; the Test Runner's thousand-seed runs don't). The pipeline then gives
each module an empty ``ctx["__wp_module_detail__"]`` dict before it resolves and
files whatever the handler put there on that module's trace row as ``detail``.

Handlers call :func:`module_detail` and write only when it returns a dict, so
an un-opted run pays one dict lookup per module and nothing else.
"""
from __future__ import annotations

from typing import Any

EXPLAIN_KEY = "__wp_explain__"
DETAIL_KEY = "__wp_module_detail__"


def module_detail(ctx: Any) -> dict[str, Any] | None:
    """The active module's detail sink, or None when nobody asked for one."""
    if not isinstance(ctx, dict):
        return None
    sink = ctx.get(DETAIL_KEY)
    return sink if isinstance(sink, dict) else None
