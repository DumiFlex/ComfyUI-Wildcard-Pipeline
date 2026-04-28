"""Combine module resolver — syntax-aware template fill.

Reads payload.template, resolves all $var / @{uuid} / {a|b|c} / {N$$sep$$...}
constructs against the runtime ctx, binds the result to payload.output_var.
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class CombineHandler(ModuleHandler):
    """Template-fill module: full syntax surface, output bound."""

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

        resolve_ctx = build_resolve_ctx(ctx, surface="combine")
        result = resolve_text(template, resolve_ctx)
        return {output_var: result}
