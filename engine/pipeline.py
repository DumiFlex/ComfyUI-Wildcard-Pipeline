"""PipelineEngine — dispatches modules through per-type handlers, records trace."""

import logging
import random
from typing import Any

from .context import Context
from .handlers import ModuleHandler, handle_fixed_values
from .modules import Module

logger = logging.getLogger(__name__)


class PipelineEngine:
    """Runs an ordered list of modules against a context dict."""

    HANDLERS: dict[str, ModuleHandler] = {
        "fixed_values": handle_fixed_values,
    }

    def run(
        self,
        modules: list[Module],
        ctx: Context | None = None,
        seed: int = 0,
    ) -> Context:
        """Execute ``modules`` top-to-bottom against ``ctx``.

        Initializes internal keys (``__wp_node_seed__``, ``__wp_trace__``,
        ``__wp_internal_flags__``) if absent. Skips modules with
        ``enabled is False``. Unknown module types are logged and skipped.
        Returns the mutated context.
        """
        ctx = {} if ctx is None else ctx
        ctx["__wp_node_seed__"] = seed
        ctx.setdefault("__wp_trace__", [])
        ctx.setdefault("__wp_internal_flags__", {})

        rng = random.Random(seed)

        for index, module in enumerate(modules):
            if getattr(module, "enabled", True) is False:
                continue

            module_type = getattr(module, "type", None)
            handler = self.HANDLERS.get(module_type or "")
            if handler is None:
                logger.warning(
                    "Unknown module type %r at index %s — skipped",
                    module_type,
                    index,
                )
                continue

            before = dict(ctx)
            ctx = handler(module, ctx, rng)
            ctx["__wp_trace__"].append(self._trace_entry(module, before, ctx))

        return ctx

    @staticmethod
    def _trace_entry(
        module: Module,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> dict[str, Any]:
        """Build a trace record describing what ``module`` wrote."""
        module_type = getattr(module, "type", "")
        writes: list[dict[str, Any]] = []

        for key in after.keys() - before.keys():
            if key.startswith("__"):
                continue
            writes.append(
                {"variable": key, "value": after[key], "source": module_type}
            )

        for key in after.keys() & before.keys():
            if key.startswith("__"):
                continue
            if after[key] == before[key]:
                continue
            writes.append(
                {
                    "variable": key,
                    "value": after[key],
                    "source": module_type,
                    "overwrite": True,
                }
            )

        return {
            "id": getattr(module, "id", ""),
            "type": module_type,
            "enabled": getattr(module, "enabled", True),
            "writes": writes,
        }
