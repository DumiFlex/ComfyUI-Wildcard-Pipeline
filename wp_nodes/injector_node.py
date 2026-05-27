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

# Tokenizer for the per-row template field. Matches `$$` (literal `$`),
# `$<name>` slot refs, and falls through to literal text.
_TEMPLATE_TOKEN_RE = re.compile(r"\$\$|\$([A-Za-z_][A-Za-z0-9_]*)")


def _render_template(template: str, slot_values: dict[str, Any]) -> str:
    """Substitute `$<slot_name>` refs with stringified socket values.

    - `$$` -> literal `$`
    - `$slot_name` where slot is wired -> stringified value at that slot
       (Python `str()` semantics — booleans yield "True"/"False" to match
       the pass-through path's downstream stringification.)
    - `$slot_name` where slot is NOT wired -> left as literal `$slot_name`
       so the user can spot the typo in the rendered output
    """

    def repl(m: re.Match[str]) -> str:
        if m.group(0) == "$$":
            return "$"
        name = m.group(1)
        if name in slot_values:
            return str(slot_values[name])
        return m.group(0)

    return _TEMPLATE_TOKEN_RE.sub(repl, template)


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
            template_raw = row.get("template", None)
            template_str = (
                template_raw.strip()
                if isinstance(template_raw, str) and template_raw.strip()
                else ""
            )
            # Pass-through path: row has no template, just needs the
            # wired socket value. Requires the slot to be wired or the
            # row is skipped (matches legacy behavior).
            if not template_str:
                if not isinstance(slot_name, str) or slot_name not in slot_values:
                    continue
                value = slot_values[slot_name]
                if isinstance(value, bool):
                    stored: Any = value
                elif isinstance(value, (str, int, float)):
                    stored = value
                else:
                    stored = str(value)
                trace_type = type(value).__name__
            else:
                # Template path: render `$<slot_name>` substitutions
                # against ALL wired sockets (not just this row's). Result
                # is always a string. The row's own slot does NOT need
                # to be wired in this case — the template might only
                # reference other rows' sockets.
                stored = _render_template(template_str, slot_values)
                trace_type = "str(template)"
            ctx[stripped] = stored
            if row.get("internal", False):
                internal_keys.add(stripped)
            traces.append({
                "node": "WP_ContextInjector",
                "binding": stripped,
                "internal": bool(row.get("internal", False)),
                "type": trace_type,
                # `value` surfaces the written ctx value in Debug's
                # trace tab. Engine module traces use `writes: [{...}]`
                # for the same purpose; injector trace stays flat
                # (single-write per row) so a top-level `value` keeps
                # the shape minimal while giving Debug something to
                # render. Stringified to keep the JSON shape stable
                # across primitive types — Debug formats further.
                "value": str(stored) if not isinstance(stored, (str, int, float, bool)) else stored,
            })

        if internal_keys:
            ctx["__wp_internal_keys__"] = sorted(internal_keys)

        # Carry user-marked-internal bindings on `__wp_internal_flags__` in the
        # cross-node `internals` field — the SAME channel WP_Context +
        # WP_ContextLoop use, and the only one the PromptAssembler consults
        # (via `strip_internals`) to keep an internal var out of the rendered
        # prompt. Writing only `__wp_internal_keys__` above left the toggle
        # cosmetic: nothing downstream stripped on it.
        out_internals = dict(upstream_internals)
        if internal_keys:
            flags = dict(out_internals.get("__wp_internal_flags__") or {})
            for name in internal_keys:
                flags[name] = True
            out_internals["__wp_internal_flags__"] = flags

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
                internals=out_internals,
            )
        )
