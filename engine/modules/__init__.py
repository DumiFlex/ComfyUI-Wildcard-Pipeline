"""Module type registry + resolver context factory."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from engine.syntax.types import ResolveContext, SurfaceKind


@dataclass
class _RuntimeResolveContext:
    """Concrete adapter from a pipeline run's ctx dict to a ResolveContext.

    Constructed via build_resolve_ctx; used by handlers when calling resolve_text.
    """

    rng: random.Random
    max_ref_depth: int
    strict: bool
    surface: SurfaceKind
    developer_mode: bool
    warnings: list[dict[str, Any]]
    _vars: dict[str, Any]
    _catalog: dict[str, dict[str, Any]]
    # Back-channels for the syntax resolver's nested-`@{}` path so it
    # can apply constraints to wildcards reached transitively (same
    # rule book as the chain-level wildcard handler). Both default to
    # empty so legacy callers that build a ResolveContext by hand keep
    # working — the resolver falls back to "no constraints" when the
    # bucket is empty/None.
    _constraints: list[dict[str, Any]] = field(default_factory=list)
    _picks: dict[str, dict[str, Any]] = field(default_factory=dict)
    # SP3 reach-selector hit counter (per-constraint, keyed by
    # `__constraint_module_id__`). Threaded by reference so increments
    # inside apply_constraints_for_target on the nested-ref path share
    # one counter with the chain-level direct path + the pipeline's ctx
    # bucket — first/next coverage spans both surfaces.
    _hits: dict[str, int] = field(default_factory=dict)

    def get_var(self, name: str) -> str | None:
        # SP2a: return the raw stored value (may be a ListVar from a
        # multi-select wildcard); the resolver formats it. Typed str | None
        # for the Protocol — a ListVar flows through at runtime via the
        # Any-valued vars dict, and the resolver narrows on isinstance.
        if name in self._vars:
            return self._vars[name]
        return None

    def get_module(self, uuid: str) -> dict[str, Any] | None:
        """Catalog lookup. Pure O(1) dict get. Spec §2.5.

        No DB fallback. No network. No side effects. If the catalog does
        not contain `uuid`, returns None and lets the resolver decide
        (lenient → warning, strict → UnknownRefError).

        Engine isolation invariant — `engine/modules/__init__.py` MUST NOT
        import from `engine.db`, `wp_api`, or `wp_nodes`. Pinned by
        `tests/engine/modules/test_resolve_context_isolation.py`.
        """
        return self._catalog.get(uuid)

    def get_constraints(self) -> list[dict[str, Any]]:
        """Registered constraints from the current pipeline run.

        Each entry is the meta dict that ``constraint_handler`` writes
        into ``ctx['__wp_constraints__']``. Used by ``_resolve_ref`` to
        apply constraints against the nested-target wildcard before
        rolling its options.
        """
        return self._constraints

    def get_picks(self) -> dict[str, dict[str, Any]]:
        """``ctx['__wp_picks__']`` — every wildcard's last pick keyed
        by module id. Constraint application needs this to look up the
        source wildcard's pick when reweighting the target."""
        return self._picks

    def get_constraint_hits(self) -> dict[str, int]:
        """``ctx['__wp_constraint_hits__']`` — per-constraint firing
        count keyed by module id. Threaded by reference so the
        nested-ref resolver's increments are observed by the pipeline +
        by subsequent target-instance resolves later in the chain
        (first/next coverage spans direct + nested encounters)."""
        return self._hits


def build_resolve_ctx(
    ctx: dict[str, Any],
    surface: SurfaceKind,
    *,
    strict: bool = False,
) -> ResolveContext:
    """Build a ResolveContext from a pipeline run's ctx dict + a surface label.

    Handlers call this with their type-appropriate surface ("wildcard" /
    "combine" / "derivation" / "assembler") then pass the result to resolve_text.
    """
    constraints = ctx.get("__wp_constraints__")
    picks = ctx.get("__wp_picks__")
    hits = ctx.setdefault("__wp_constraint_hits__", {})
    return _RuntimeResolveContext(  # type: ignore[return-value]
        rng=ctx["__wp_rng__"],
        max_ref_depth=int(ctx.get("__wp_max_ref_depth__", 8)),
        strict=strict,
        surface=surface,
        developer_mode=bool(ctx.get("__wp_developer_mode__", False)),
        warnings=ctx["__wp_warnings__"],
        _vars={k: v for k, v in ctx.items() if not k.startswith("__")},
        _catalog=ctx.get("__wp_catalog__", {}),
        # Constraint bucket + picks table threaded through so the
        # syntax resolver's `_resolve_ref` can apply chain-level
        # constraints against nested-via-`@{}` target wildcards. Both
        # may be missing (legacy ctx, tests that pre-date constraint
        # support) — defaults handle that path.
        _constraints=constraints if isinstance(constraints, list) else [],
        _picks=picks if isinstance(picks, dict) else {},
        # SP3 hit counter — passed by reference so the nested-ref
        # resolver's increments stick in ctx + share one counter with
        # the direct path for first/next coverage.
        _hits=hits if isinstance(hits, dict) else {},
    )


from engine.modules.dispatcher import (  # noqa: E402
    ModuleHandler,
    UnknownModuleType,
    get_handler,
    register_handler,
    resolve_module,
)
from engine.modules.snapshot import (  # noqa: E402
    coerce_legacy_module,
    freeze_snapshot,
    payload_hash,
)
from engine.modules.types import (  # noqa: E402
    FixedValueEntry,
    FixedValueModule,
    Module,
    ModuleMeta,
    module_from_dict,
    module_to_dict,
)

__all__ = [
    "FixedValueEntry",
    "FixedValueModule",
    "Module",
    "ModuleMeta",
    "module_from_dict",
    "module_to_dict",
]

__all__ += [
    "coerce_legacy_module",
    "freeze_snapshot",
    "payload_hash",
]

__all__ += [
    "ModuleHandler",
    "UnknownModuleType",
    "get_handler",
    "register_handler",
    "resolve_module",
]

from engine.modules.wildcard_handler import WildcardHandler  # noqa: E402
from engine.syntax import RecursionLimitExceeded  # noqa: E402

register_handler(WildcardHandler)

__all__ += [
    "RecursionLimitExceeded",
    "WildcardHandler",
]

from engine.modules.fixed_values_handler import FixedValuesHandler  # noqa: E402

register_handler(FixedValuesHandler)

__all__ += ["FixedValuesHandler"]

from engine.modules.combine_handler import CombineHandler  # noqa: E402
from engine.modules.constraint_handler import ConstraintHandler  # noqa: E402
from engine.modules.derivation_handler import DerivationHandler  # noqa: E402

register_handler(CombineHandler)
register_handler(DerivationHandler)
register_handler(ConstraintHandler)

__all__ += [
    "CombineHandler",
    "ConstraintHandler",
    "DerivationHandler",
]

__all__ += ["build_resolve_ctx"]
