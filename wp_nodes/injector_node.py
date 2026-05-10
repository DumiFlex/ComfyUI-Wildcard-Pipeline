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
                # NO `io.Autogrow.Input` here. V3 Autogrow declares all
                # `max` slots up-front (see comfy_api/latest/_io.py:997)
                # and ComfyUI's frontend doesn't shrink on disconnect.
                # We manage `input_*` sockets manually on the frontend
                # via litegraph's `addInput`/`removeInput` (see
                # `src/widgets/injector.ts`) and rely on
                # `accept_all_inputs=True` to receive whatever kwargs
                # the user has wired at execute time.
            ],
            outputs=[PipelineContext.Output("context")],
            not_idempotent=True,
            accept_all_inputs=True,
        )

    @classmethod
    def execute(cls, rows: str = "", upstream: PipelineContext | None = None, **slot_values: Any):
        # V3 Autogrow namespaces dynamic inputs as `inputs.input_0`,
        # `inputs.input_1`, … — but the widget JSON's `slot_name` field
        # holds the bare label `input_0`. Normalize incoming kwargs to
        # strip the parent input id prefix so lookups work with either
        # form (whatever ComfyUI's executor decides to pass).
        normalized: dict[str, Any] = {}
        for key, val in slot_values.items():
            if key.startswith("inputs."):
                normalized[key[len("inputs."):]] = val
            else:
                normalized[key] = val
        slot_values = normalized

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
        traces: list[dict] = []
        internal_keys: set[str] = set()
        existing_internal = upstream_ctx.get("__wp_internal_keys__")
        if isinstance(existing_internal, list):
            internal_keys.update(existing_internal)
        elif isinstance(existing_internal, set):
            internal_keys.update(existing_internal)

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
                stored: Any = value
            elif isinstance(value, (str, int, float)):
                stored = value
            else:
                stored = str(value)
            ctx[stripped] = stored
            if row.get("internal", False):
                internal_keys.add(stripped)
            traces.append({
                "node": "WP_ContextInjector",
                "binding": stripped,
                "internal": bool(row.get("internal", False)),
                "type": type(value).__name__,
            })

        if internal_keys:
            ctx["__wp_internal_keys__"] = sorted(internal_keys)

        debug = dict(upstream_debug)
        if traces:
            existing_trace = debug.get("__wp_trace__", [])
            debug["__wp_trace__"] = list(existing_trace) + traces
        if warnings:
            existing_warn = debug.get("__wp_warnings__", [])
            debug["__wp_warnings__"] = list(existing_warn) + warnings

        return io.NodeOutput(
            PipelineContext.Type(
                context=ctx,
                debug=debug,
                internals=dict(upstream_internals),
            )
        )
