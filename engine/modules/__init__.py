"""Module dataclasses, snapshot helpers, dispatcher, handlers."""
from engine.modules.dispatcher import (
    ModuleHandler,
    UnknownModuleType,
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
    "register_handler",
    "resolve_module",
]

from engine.modules.wildcard_handler import RecursionLimitExceeded, WildcardHandler  # noqa: E402

register_handler(WildcardHandler)

__all__ += [
    "RecursionLimitExceeded",
    "WildcardHandler",
]
