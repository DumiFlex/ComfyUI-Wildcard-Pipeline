"""Module dataclasses, snapshot helpers, dispatcher, handlers."""
from engine.modules.dispatcher import (
    ModuleHandler,
    UnknownModuleType,
    get_handler,
    register_handler,
    resolve_module,
)
from engine.modules.snapshot import (
    coerce_legacy_module,
    freeze_snapshot,
    payload_hash,
)
from engine.modules.types import (
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

from engine.modules.wildcard_handler import RecursionLimitExceeded, WildcardHandler  # noqa: E402

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
