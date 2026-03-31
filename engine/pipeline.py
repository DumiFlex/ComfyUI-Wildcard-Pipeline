"""Pipeline execution engine."""

from __future__ import annotations

from typing import Any


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
        for module in modules:
            module_type = module.get("type", "")
            handler = self._get_handler(module_type)
            if handler:
                ctx = handler(module, ctx)
        return ctx

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
        """Weighted random sample from options, capture result as $var."""
        # Stub — full implementation in Phase 1
        options = module.get("options", [])
        capture_as = module.get("capture_as", "")

        if options and capture_as:
            # Placeholder: pick first option (weighted sampling in Phase 1)
            value = options[0].get("value", "") if options else ""
            if capture_as.startswith("$"):
                capture_as = capture_as[1:]
            ctx[capture_as] = value

        return ctx

    def _handle_fixed(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Static hardcoded string, captured as $var."""
        value = module.get("value", "")
        capture_as = module.get("capture_as", "")

        if capture_as:
            if capture_as.startswith("$"):
                capture_as = capture_as[1:]
            ctx[capture_as] = value

        return ctx

    def _handle_combine(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Merge variables using a template string, capture as $var."""
        template = module.get("template", "")
        capture_as = module.get("capture_as", "")

        # Resolve $var references in template
        result = template
        for key, value in ctx.items():
            if key.startswith("__"):
                continue
            result = result.replace(f"${key}", str(value))

        if capture_as:
            if capture_as.startswith("$"):
                capture_as = capture_as[1:]
            ctx[capture_as] = result

        return ctx
