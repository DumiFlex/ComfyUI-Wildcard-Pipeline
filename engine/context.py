"""Context type definitions and internals helpers.

The engine uses a flat ``dict[str, Any]`` for context. Keys starting with ``__``
are reserved for engine internals (seed, trace, internal flags). User-defined
variables use plain identifier names.
"""

from __future__ import annotations

from typing import Any, TypedDict


class ContextInternals(TypedDict, total=False):
    """Documents the reserved internal keys. Not enforced at runtime."""

    __wp_node_seed__: int
    __wp_internal_flags__: dict[str, bool]
    __wp_trace__: list[dict[str, Any]]


Context = dict[str, Any]


def strip_internals(ctx: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``ctx`` without ``__``-prefixed internal keys."""
    return {k: v for k, v in ctx.items() if not k.startswith("__")}
