"""Pipeline execution engine.

Pure Python — ZERO ComfyUI imports. Testable standalone via pytest.
"""

from __future__ import annotations

import logging
import random
import re
from typing import Any

logger = logging.getLogger(__name__)

_MODULE_SCHEMAS: dict[str, set[str]] = {
    "wildcard": {"capture_as"},
    "fixed": {"value", "capture_as"},
    "combine": {"template", "capture_as"},
}


def _normalize_capture(capture_as: str) -> str:
    """Strip leading ``$`` from a capture_as name."""
    if capture_as.startswith("$"):
        return capture_as[1:]
    return capture_as


def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Resolve ``$var`` references in *template* from *ctx*.

    Rules:
        - ``$var`` is replaced with the value of ``ctx["var"]``.
        - ``$$`` is an escape for a literal ``$``.
        - Internal keys (``__`` prefix) are never substituted.
        - Missing variables are left as-is (``$unknown`` stays).
    """
    # First, protect escaped $$ by replacing with a sentinel
    sentinel = "\x00DOLLAR\x00"
    result = template.replace("$$", sentinel)

    def _replacer(match: re.Match[str]) -> str:
        var_name = match.group(1)
        if var_name.startswith("__"):
            return match.group(0)  # leave internal keys untouched
        if var_name in ctx:
            return str(ctx[var_name])
        return match.group(0)  # leave unresolved vars as-is

    result = re.sub(r"\$(\w+)", _replacer, result)

    # Restore escaped dollars
    result = result.replace(sentinel, "$")

    return result


class PipelineEngine:
    """Runs an ordered list of pipeline modules, accumulating resolved
    variables into a context dict.

    This is a pure-Python class with no ComfyUI dependency, making it
    fully testable outside ComfyUI.
    """

    def run(self, modules: list[dict[str, Any]], ctx: dict[str, Any]) -> dict[str, Any]:
        """Execute modules top-to-bottom, returning the updated context.

        Args:
            modules: List of module config dicts from the Vue widget.
            ctx: Current pipeline context (may contain variables from
                 upstream pipeline nodes).

        Returns:
            Updated context dict with all newly resolved variables.
        """
        for i, module in enumerate(modules):
            module_type = module.get("type", "")

            if not self._validate_module(module, i):
                continue

            handler = self._get_handler(module_type)
            if handler is None:
                logger.warning(
                    "Unknown module type '%s' at index %d — skipped", module_type, i
                )
                continue

            ctx = handler(module, ctx)

        return ctx

    @staticmethod
    def _validate_module(module: dict[str, Any], index: int) -> bool:
        """Return True if *module* has all required keys for its type.

        Logs a warning and returns False for malformed modules so the
        pipeline can continue without crashing.
        """
        module_type = module.get("type", "")
        if not module_type:
            logger.warning("Module at index %d has no 'type' key — skipped", index)
            return False

        required = _MODULE_SCHEMAS.get(module_type)
        if required is None:
            # Unknown type — validation passes; handler dispatch will skip it
            return True

        missing = required - module.keys()
        if missing:
            logger.warning(
                "Module '%s' at index %d missing required keys %s — skipped",
                module_type,
                index,
                missing,
            )
            return False

        return True

    def _get_handler(self, module_type: str):
        """Return the handler function for a module type, or None."""
        handlers = {
            "wildcard": self._handle_wildcard,
            "fixed": self._handle_fixed,
            "combine": self._handle_combine,
        }
        return handlers.get(module_type)

    def _handle_wildcard(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Weighted random sample from options, capture result as ``$var``."""
        options = module.get("options", [])
        capture_as = module.get("capture_as", "")

        if not options or not capture_as:
            return ctx

        weights = [opt.get("weight", 1.0) for opt in options]

        # all-zero weights → uniform sampling
        if all(w == 0 for w in weights):
            weights = [1.0] * len(weights)

        chosen = random.choices(options, weights=weights, k=1)[0]
        value = chosen.get("value", "")

        capture_as = _normalize_capture(capture_as)
        ctx[capture_as] = value

        return ctx

    def _handle_fixed(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Static hardcoded string, captured as ``$var``."""
        value = module.get("value", "")
        capture_as = module.get("capture_as", "")

        if not capture_as:
            return ctx

        capture_as = _normalize_capture(capture_as)
        ctx[capture_as] = value

        return ctx

    def _handle_combine(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Merge variables using a template string, capture as ``$var``."""
        template = module.get("template", "")
        capture_as = module.get("capture_as", "")

        result = resolve_variables(template, ctx)

        if capture_as:
            capture_as = _normalize_capture(capture_as)
            ctx[capture_as] = result

        return ctx
