"""Module type registry + resolver context factory."""
from __future__ import annotations

import random
from dataclasses import dataclass
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

    def get_var(self, name: str) -> str | None:
        if name in self._vars:
            return str(self._vars[name])
        return None

    def get_module(self, uuid: str) -> dict[str, Any] | None:
        return self._catalog.get(uuid)


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
    return _RuntimeResolveContext(  # type: ignore[return-value]
        rng=ctx["__wp_rng__"],
        max_ref_depth=int(ctx.get("__wp_max_ref_depth__", 8)),
        strict=strict,
        surface=surface,
        developer_mode=bool(ctx.get("__wp_developer_mode__", False)),
        warnings=ctx["__wp_warnings__"],
        _vars={k: v for k, v in ctx.items() if not k.startswith("__")},
        _catalog=ctx.get("__wp_catalog__", {}),
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
from engine.modules.pipeline_handler import PipelineHandler  # noqa: E402

register_handler(CombineHandler)
register_handler(DerivationHandler)
register_handler(ConstraintHandler)
register_handler(PipelineHandler)

__all__ += [
    "CombineHandler",
    "ConstraintHandler",
    "DerivationHandler",
    "PipelineHandler",
]

__all__ += ["build_resolve_ctx"]
