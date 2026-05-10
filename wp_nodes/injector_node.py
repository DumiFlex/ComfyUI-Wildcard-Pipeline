"""WP_ContextInjector — lifts arbitrary ComfyUI outputs into named
$var ctx bindings on the PipelineContext.

Spec: docs/superpowers/specs/2026-05-10-context-injector-design.md
"""
from __future__ import annotations

import json
import re
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from wp_nodes.types import InjectorRowsInput, PipelineContext

_BINDING_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")


class WPContextInjector(io.ComfyNode):
    """Graph-side ctx writer. No library, no payload, no resolve-time logic.

    For each enabled row with a non-empty binding AND a live wire,
    writes ``ctx[binding] = stringify(value)``.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_ContextInjector",
            display_name="WP Context Injector",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("upstream", optional=True),
                InjectorRowsInput.Input("rows", socketless=True),
                io.Autogrow.Input(
                    "inputs",
                    template=io.Autogrow.TemplatePrefix(
                        io.AnyType.Input("value"),
                        prefix="input_",
                        min=0,
                        max=100,
                    ),
                    optional=True,
                ),
            ],
            outputs=[PipelineContext.Output("context")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, rows: str = "", upstream: PipelineContext | None = None, **slot_values: Any):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}

        ctx: dict = dict(upstream_ctx)
        for key, value in upstream_internals.items():
            if isinstance(value, list):
                ctx[key] = list(value)
            elif isinstance(value, dict):
                ctx[key] = dict(value)
            else:
                ctx[key] = value

        # Empty rows / parse failure → forward unchanged.
        try:
            parsed = json.loads(rows) if rows else {"version": 1, "rows": []}
        except json.JSONDecodeError:
            parsed = {"version": 1, "rows": []}

        warnings: list[dict] = []
        rows_list = parsed.get("rows", []) if isinstance(parsed, dict) else []
        for row in rows_list:
            if not isinstance(row, dict):
                continue
            if not row.get("enabled", False):
                continue
            binding = row.get("binding", "")
            if not isinstance(binding, str) or not binding.strip():
                continue
            stripped = binding.strip()
            if stripped.startswith("_"):
                warnings.append({
                    "type": "injector_reserved_binding",
                    "binding": stripped,
                    "row_uid": row.get("_uid"),
                })
                continue
            if not _BINDING_RE.match(stripped):
                warnings.append({
                    "type": "injector_invalid_binding",
                    "binding": stripped,
                    "row_uid": row.get("_uid"),
                })
                continue
            slot_name = row.get("slot_name", "")
            if not isinstance(slot_name, str) or slot_name not in slot_values:
                continue
            value = slot_values[slot_name]
            if isinstance(value, bool):
                ctx[stripped] = value
            elif isinstance(value, (str, int, float)):
                ctx[stripped] = value
            else:
                ctx[stripped] = str(value)

        debug = dict(upstream_debug)
        if warnings:
            existing = debug.get("__wp_warnings__", [])
            debug["__wp_warnings__"] = list(existing) + warnings

        return io.NodeOutput(
            PipelineContext.Type(
                context=ctx,
                debug=debug,
                internals=dict(upstream_internals),
            )
        )
