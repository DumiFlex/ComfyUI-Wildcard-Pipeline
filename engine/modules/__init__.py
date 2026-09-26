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
    # SP3 nested-pick carrier identity for the CURRENT resolve frame:
    # the wildcard whose chosen option value textually contains the
    # `@{T}` ref being resolved, plus that option's id. MUTABLE +
    # save/restored by the resolver around each nested-option recursion
    # (mirroring the rng swap) so `_resolve_ref` can tell
    # apply_constraints_for_target which (carrier_uid, option_id) is
    # firing target T — the only thing a `pick` selector's `nested`
    # occurrence matches on. None outside any carrier option.
    _carrier_uid: str | None = None
    _carrier_option_id: str | None = None
    # Rolled `accepts`-axis choices, keyed by VARIABLE BINDING (the namespace
    # `$outfit.SHOES` addresses) rather than module uuid like `_picks`. A
    # projection of `ctx["__wp_axes__"]`, built once here so the resolver stays
    # a pure consumer with no ctx dependency.
    _axes: dict[str, Any] = field(default_factory=dict)
    # Accepts axes each binding's wildcard declares (`ctx["__wp_axis_decl__"]`),
    # so an empty axis read can say whether the axis is missing or the pick
    # simply carried no tag on it.
    _axis_decl: dict[str, Any] = field(default_factory=dict)
    # Opt-in record of every nested `@{uuid}` pick (`ctx["__wp_ref_log__"]`,
    # a list the caller seeds, e.g. the Test Runner). None when the caller
    # did not ask, so a canvas run records nothing. `_ref_owner` is the
    # stack uid of the module whose resolve this frame belongs to.
    _ref_log: list[dict[str, Any]] | None = None
    _ref_owner: str | None = None

    def log_ref(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        """Append one nested-ref pick to the ref log, tagged with the
        owning module's uid, and return the stored dict (so the resolver
        can fill in the resolved text after recursing). No-op → None when
        no log was requested."""
        if self._ref_log is None:
            return None
        row = {"owner": self._ref_owner, **entry}
        self._ref_log.append(row)
        return row

    def get_axis(self, name: str, axis: str) -> Any:
        """Rolled axis choice(s) for a binding, or None when it has none.

        Returns a plain string for a single-pick source and a list (one entry
        per pick, in pick order) for a multi-select one, mirroring the shape of
        the variable itself. Shaping and the empty/warn decision belong to the
        resolver; this only fetches.

        A binding that rolled no axes at all, and a binding that rolled some
        but not THIS one, both yield None — the caller cannot act differently
        on those two, and collapsing them keeps the read a single lookup.
        """
        entry = self._axes.get(name)
        if isinstance(entry, list):
            # Positional: one slot per pick, None where that pick's option
            # carries no tag on this axis. Compacting the gaps away shifted
            # every later pick down, so `$outfit.1.SHOES` read pick 2's shoe
            # beside `$outfit.1`.
            got = [e.get(axis) if isinstance(e, dict) else None for e in entry]
            return got if any(g is not None for g in got) else None
        if isinstance(entry, dict):
            return entry.get(axis)
        return None

    def declared_axes(self, name: str) -> list[str] | None:
        """Accepts axes the wildcard bound to `name` declares, or None when
        that is unknown (nothing recorded, e.g. a ctx from before this table
        existed or a binding no wildcard wrote)."""
        got = self._axis_decl.get(name)
        return [str(a) for a in got] if isinstance(got, list) else None

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

    def set_carrier(self, carrier_uid: str | None, option_id: str | None) -> None:
        """Set the CURRENT carrier identity (the wildcard whose chosen
        option value contains the `@{T}` ref about to resolve, + that
        option's id). The resolver save/restores this around each nested
        option recursion (mirroring the rng swap)."""
        self._carrier_uid = carrier_uid
        self._carrier_option_id = option_id

    def get_carrier(self) -> tuple[str | None, str | None]:
        """Return the current ``(carrier_uid, option_id)`` so the
        resolver can save it before a recursion and restore it after."""
        return self._carrier_uid, self._carrier_option_id

    def get_carrier_ctx(self) -> dict[str, Any] | None:
        """The current carrier as the dict shape
        ``apply_constraints_for_target`` /
        ``_constraints._occurrence_matches`` expect, or ``None`` when no
        carrier is set (outside any carrier option — e.g. a top-level
        ref). A `pick` selector's `nested` entry matches on these two
        keys; every other selector mode ignores them."""
        if self._carrier_uid is None and self._carrier_option_id is None:
            return None
        return {"carrier_uid": self._carrier_uid, "option_id": self._carrier_option_id}


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
    axes = ctx.get("__wp_axes__")
    axis_decl = ctx.get("__wp_axis_decl__")
    hits = ctx.setdefault("__wp_constraint_hits__", {})
    ref_log = ctx.get("__wp_ref_log__")
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
        # Same treatment as `_vars`: a projection built at frame construction,
        # so `get_axis` is a dict lookup and the resolver never reaches into
        # ctx.
        _axes=axes if isinstance(axes, dict) else {},
        _axis_decl=axis_decl if isinstance(axis_decl, dict) else {},
        _ref_log=ref_log if isinstance(ref_log, list) else None,
        _ref_owner=ctx.get("__wp_current_module_uid__"),
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
