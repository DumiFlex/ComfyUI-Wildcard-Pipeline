"""Combine module resolver — fills a string template from existing bindings.

A combine module reads ``$varname`` tokens out of ``payload["template"]`` and
substitutes the matching value from the runtime context. The result is bound
to ``payload["output_var"]``. Tokens whose variable is not yet bound in the
context fall through unchanged (so downstream modules can still see them).
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules.dispatcher import ModuleHandler

_TOKEN_RE = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")
_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _ctx_get(ctx: Any, name: str, default: str) -> str:
    """Best-effort read of ``name`` from a runtime context.

    Supports plain dicts (or anything ``in``-testable that supports
    ``__getitem__``) as well as the engine's own Context class which exposes
    ``get(name, default)``.
    """
    if ctx is None:
        return default
    getter = getattr(ctx, "get", None)
    if callable(getter):
        try:
            value = getter(name, default)
        except TypeError:
            # Some Mapping-like objects only accept one positional arg.
            try:
                value = getter(name)
                if value is None:
                    value = default
            except Exception:
                return default
        return str(value) if value is not None else default
    try:
        if name in ctx:  # type: ignore[operator]
            return str(ctx[name])  # type: ignore[index]
    except Exception:
        return default
    return default


def _ctx_set(ctx: Any, name: str, value: str) -> None:
    """Best-effort write of ``name=value`` into a runtime context."""
    if ctx is None:
        return
    setter = getattr(ctx, "set", None)
    if callable(setter):
        setter(name, value)
        return
    try:
        ctx[name] = value  # type: ignore[index]
    except Exception:
        # Context object is read-only / unsupported — silently no-op.
        return


class CombineHandler(ModuleHandler):
    """Template-fill module: ``$var`` tokens replaced from ctx, result bound."""

    type_id = "combine"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("combine payload must be an object")
        template = payload.get("template")
        if not isinstance(template, str):
            raise ValueError("combine payload.template must be a string")
        output_var = payload.get("output_var")
        if not isinstance(output_var, str) or not output_var:
            raise ValueError("combine payload.output_var must be a non-empty string")
        if not _IDENT_RE.match(output_var):
            raise ValueError(
                f"combine payload.output_var {output_var!r} is not a valid identifier"
            )
        input_vars = payload.get("input_vars", [])
        if not isinstance(input_vars, list):
            raise ValueError("combine payload.input_vars must be a list")
        for v in input_vars:
            if not isinstance(v, str):
                raise ValueError("combine payload.input_vars entries must be strings")

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        cls.validate_payload(payload)
        template: str = payload["template"]
        output_var: str = payload["output_var"]

        def _sub(match: re.Match[str]) -> str:
            name = match.group(1)
            return _ctx_get(ctx, name, f"${name}")

        result = _TOKEN_RE.sub(_sub, template)
        _ctx_set(ctx, output_var, result)
        return {output_var: result}
