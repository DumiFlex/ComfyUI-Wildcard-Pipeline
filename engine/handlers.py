"""Per-module-type handlers. One function per module type.

Handler signature is ``(module, ctx, rng) -> Context``. Returns the (possibly
mutated) context. ``rng`` is a ``random.Random`` supplied by the pipeline —
``fixed_values`` ignores it; seed-consuming handlers (wildcard, derivation)
use it in later specs.
"""

from __future__ import annotations

import logging
import random
from collections.abc import Callable
from typing import Any, TypeAlias

from .context import Context
from .modules import FixedValueModule

logger = logging.getLogger(__name__)

ModuleHandler: TypeAlias = Callable[[Any, Context, random.Random], Context]


def handle_fixed_values(
    module: FixedValueModule,
    ctx: Context,
    rng: random.Random,  # noqa: ARG001
) -> Context:
    """Write each entry's value into ``ctx``. Mutates and returns ``ctx``."""
    for entry in module.entries:
        name = entry.variable_name.lstrip("$")
        if not name:
            logger.warning(
                "Skipping entry with empty variable_name in module %s", module.id
            )
            continue
        ctx[name] = entry.value
    return ctx
