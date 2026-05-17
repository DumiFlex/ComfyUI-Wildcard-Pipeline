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
    """Return a copy of ``ctx`` with engine-only + user-flagged-internal keys removed.

    Use at the *prompt render* boundary (PromptAssembler) — both engine
    bookkeeping AND user-marked-internal vars are filtered:

      1. ``__``-prefixed keys: engine bookkeeping (``__wp_node_seed__``,
         ``__wp_trace__``, ``__wp_internal_flags__``, …).
      2. Keys whose name appears with ``True`` in the
         ``__wp_internal_flags__`` map: user-marked-internal bindings
         from modules with ``instance.internal == True``. These vars
         drive composition (other modules can read them) but must not
         appear as standalone ``$var`` substitutions in the rendered
         prompt — that's the "internal" UX promise.

    For the *socket* boundary (PIPELINE_CONTEXT carrying state between
    Context nodes), use ``strip_engine_internals`` instead — it drops
    only the ``__``-prefixed engine keys so user-flagged internal vars
    continue to propagate through downstream Context / Combine / etc.
    until they reach a PromptAssembler that filters them at render
    time.
    """
    flags = ctx.get("__wp_internal_flags__")
    internal_names: set[str] = set()
    if isinstance(flags, dict):
        internal_names = {k for k, v in flags.items() if v}
    return {
        k: v for k, v in ctx.items()
        if not k.startswith("__") and k not in internal_names
    }


def strip_engine_internals(ctx: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``ctx`` with only the ``__``-prefixed engine keys removed.

    User-flagged internal vars stay in the result — they need to
    propagate across Context-node boundaries so downstream Combine /
    Derivation / Constraint modules can read them. Only the final
    PromptAssembler filters them out at render time (via
    ``strip_internals``) so they don't appear as standalone ``$var``
    substitutions in the prompt text.
    """
    return {k: v for k, v in ctx.items() if not k.startswith("__")}
