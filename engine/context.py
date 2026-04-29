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
    """Return a copy of ``ctx`` without engine-only keys.

    Two layers of "internal" get removed:
      1. ``__``-prefixed keys: engine bookkeeping (``__wp_node_seed__``,
         ``__wp_trace__``, ``__wp_internal_flags__``, …).
      2. Keys whose name appears with ``True`` in the
         ``__wp_internal_flags__`` map: user-marked-internal bindings
         from modules with ``instance.internal == True``. These keys
         stay in ctx during pipeline execution so downstream modules
         can read them, but never surface on the public socket
         payload — handy for "scratch" vars that drive a derivation
         but should not become prompt-text noise.
    """
    flags = ctx.get("__wp_internal_flags__")
    internal_names: set[str] = set()
    if isinstance(flags, dict):
        internal_names = {k for k, v in flags.items() if v}
    return {
        k: v for k, v in ctx.items()
        if not k.startswith("__") and k not in internal_names
    }
