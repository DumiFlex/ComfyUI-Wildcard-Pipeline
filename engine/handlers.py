"""Per-module-type handlers. One function per module type.

Handler signature is ``(module, ctx, rng) -> Context``. Returns the (possibly
mutated) context. As of this commit, the actual resolution lives in
``engine.modules.dispatcher``; the function below is now a thin bridge that
coerces the legacy dataclass shape, calls ``resolve_module``, and writes the
result back into ``ctx``.
"""

import dataclasses
import logging
import random
from collections.abc import Callable
from typing import Any, TypeAlias

from .context import Context
from .modules import FixedValueModule, coerce_legacy_module, resolve_module

logger = logging.getLogger(__name__)

ModuleHandler: TypeAlias = Callable[[Any, Context, random.Random], Context]


def handle_fixed_values(
    module: FixedValueModule,
    ctx: Context,
    _rng: random.Random,
) -> Context:
    """Write each entry's value into ``ctx`` via the new dispatcher bridge.

    ``_rng`` is accepted for signature parity with seed-consuming handlers.
    """
    raw = (
        dict(module)
        if isinstance(module, dict)
        else dataclasses.asdict(module)
    )
    snapshot = coerce_legacy_module(raw)
    bindings = resolve_module(snapshot, ctx=None)
    for var_name, value in bindings.items():
        name = var_name.lstrip("$")
        if not name:
            logger.warning(
                "Skipping binding with empty variable_name in module %s",
                module.id,
            )
            continue
        ctx[name] = value
    return ctx
