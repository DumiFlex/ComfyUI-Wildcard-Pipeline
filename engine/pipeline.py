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
    "constrain": set(),
    "condition": {"variable"},
    "export": {"variables"},
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


def apply_constraints(
    options: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    ctx: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply constraint rules to a set of wildcard options using context variable lookup.

    For each rule, looks up ``ctx[rule["when_variable"]]`` and compares to
    ``rule["when_value"]``.  Only applies the rule if they match.  Two rule
    types are supported:

    - ``exclusion`` — remove options whose ``value`` is in the rule's
      ``values`` list.
    - ``weight_bias`` — multiply the ``weight`` of matching options by
      the rule's ``multiplier``.

    Returns a new list — original options are not mutated.
    """
    result = [opt.copy() for opt in options]

    for rule in rules:
        when_var = rule.get("when_variable", "")
        when_value = rule.get("when_value", "")
        if ctx.get(when_var, "") != when_value:
            continue

        rule_type = rule.get("rule_type", "")
        target_values = rule.get("values", [])

        if rule_type == "exclusion":
            result = [opt for opt in result if opt.get("value") not in target_values]
        elif rule_type == "weight_bias":
            multiplier = rule.get("multiplier", 1.0)
            for opt in result:
                if opt.get("value") in target_values:
                    opt["weight"] = opt.get("weight", 1.0) * multiplier
        else:
            msg = f"Unknown constraint rule_type '{rule_type}' — skipped"
            logger.warning(msg)

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
                msg = f"Unknown module type '{module_type}' at index {i} — skipped"
                logger.warning(msg)
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
            msg = f"Module at index {index} has no 'type' key — skipped"
            logger.warning(msg)
            return False

        required = _MODULE_SCHEMAS.get(module_type)
        if required is None:
            return True

        missing = required - module.keys()
        if missing:
            msg = f"Module '{module_type}' at index {index} missing required keys {missing} — skipped"
            logger.warning(msg)
            return False

        return True

    def _get_handler(self, module_type: str):
        """Return the handler function for a module type, or None."""
        handlers = {
            "wildcard": self._handle_wildcard,
            "fixed": self._handle_fixed,
            "combine": self._handle_combine,
            "constrain": self._handle_constrain,
            "condition": self._handle_condition,
            "export": self._handle_export,
        }
        return handlers.get(module_type)

    def _handle_wildcard(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Weighted random sample from options, capture result as ``$var``.

        Before sampling, applies any registered constraints from
        ``ctx["__constraints__"]`` whose ``target`` matches this wildcard's
        ``capture_as`` variable.
        """
        options = module.get("options", [])
        capture_as = module.get("capture_as", "")

        if not options or not capture_as:
            return ctx

        capture_as_normalized = _normalize_capture(capture_as)

        # Apply registered constraints targeting this variable
        registered_constraints = ctx.get("__constraints__", [])
        matching_rules = [
            r
            for r in registered_constraints
            if r.get("target") == capture_as_normalized
        ]
        if matching_rules:
            options = apply_constraints(options, matching_rules, ctx)

        # If all options excluded, warn and return without capturing
        if not options:
            msg = f"All options excluded by constraints for '${capture_as_normalized}'"
            logger.warning(msg)
            return ctx

        weights = [opt.get("weight", 1.0) for opt in options]

        # all-zero weights → uniform sampling
        if all(w == 0 for w in weights):
            weights = [1.0] * len(options)

        chosen = random.choices(options, weights=weights, k=1)[0]
        value = chosen.get("value", "")

        ctx[capture_as_normalized] = value

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

    def _handle_constrain(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Register constraint rules into ctx for later application by wildcard handlers.

        Does NOT resample or capture any variable. Rules are stored in
        ``ctx["__constraints__"]`` and applied by ``_handle_wildcard()`` before
        sampling.
        """
        rules = module.get("rules", [])
        if rules:
            constraints = ctx.setdefault("__constraints__", [])
            constraints.extend(rules)
        return ctx

    def _handle_condition(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Conditionally set a variable based on context state.

        Supports two modes:
        - ``if_equals``: Set ``value`` when ``ctx[variable] == if_equals``.
        - ``unless_equals``: Set ``value`` when ``ctx[variable] != unless_equals``.

        The ``capture_as`` key stores the result. If the condition is
        not met and a ``fallback`` is provided, the fallback value is
        used instead.
        """
        variable = module.get("variable", "")
        capture_as = module.get("capture_as", "")

        if not variable or not capture_as:
            return ctx

        variable = _normalize_capture(variable)
        capture_as = _normalize_capture(capture_as)

        current_value = ctx.get(variable)
        value = module.get("value", "")
        fallback = module.get("fallback", "")

        if_equals = module.get("if_equals")
        unless_equals = module.get("unless_equals")

        condition_met = False

        if if_equals is not None:
            condition_met = current_value == if_equals
        elif unless_equals is not None:
            condition_met = current_value != unless_equals
        else:
            condition_met = current_value is not None

        if condition_met:
            ctx[capture_as] = value
        elif fallback:
            ctx[capture_as] = fallback

        return ctx

    def _handle_export(
        self, module: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        """Copy selected context variables into ``__exports__``.

        ``variables`` is a list of variable names (with or without ``$``
        prefix) to export.  A ``prefix`` can be specified to namespace
        the exported keys.
        """
        variables = module.get("variables", [])
        prefix = module.get("prefix", "")

        if not variables:
            return ctx

        exports = ctx.get("__exports__", {})

        for var in variables:
            var = _normalize_capture(var)
            if var in ctx:
                export_key = f"{prefix}{var}" if prefix else var
                exports[export_key] = ctx[var]

        ctx["__exports__"] = exports

        return ctx
