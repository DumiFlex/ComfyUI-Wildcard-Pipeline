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
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Variables pass "
                        "through; this node's rows write fresh bindings on "
                        "top. Leave unconnected to start a new chain."
                    ),
                ),
                InjectorRowsInput.Input("wp_rows", socketless=True),
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
    def execute(
        cls,
        wp_rows: str = "",
        upstream: PipelineContext | None = None,
        **slot_values: Any,
    ):
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
            parsed = json.loads(wp_rows) if wp_rows else {"version": 1, "rows": []}
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

        def _emit_trace(
            binding_name: str, stored_val: Any, trace_kind: str, is_internal: bool
        ) -> None:
            # `value` surfaces the written ctx value in Debug's trace
            # tab. Engine module traces use `writes: [{...}]` for the
            # same purpose; injector trace stays flat (single-write per
            # row) so a top-level `value` keeps the shape minimal while
            # giving Debug something to render. Stringified to keep the
            # JSON shape stable across primitive types — Debug formats
            # further.
            value = (
                stored_val
                if isinstance(stored_val, (str, int, float, bool))
                else str(stored_val)
            )
            traces.append({
                "node": "WP_ContextInjector",
                "binding": binding_name,
                "internal": is_internal,
                "type": trace_kind,
                "value": value,
            })

        def _validated_binding(row: dict) -> str | None:
            """Shared binding validation for both row kinds. Returns the
            stripped binding, or None when the row should be skipped
            (appending a warning for reserved / invalid names)."""
            binding = row.get("binding", "")
            if not isinstance(binding, str) or not binding.strip():
                return None
            stripped = binding.strip()
            if stripped.startswith("_"):
                warnings.append({
                    "type": "injector_reserved_binding",
                    "binding": stripped,
                    "row_uid": row.get("_uid"),
                })
                return None
            if not _BINDING_RE.match(stripped):
                warnings.append({
                    "type": "injector_invalid_binding",
                    "binding": stripped,
                    "row_uid": row.get("_uid"),
                })
                return None
            return stripped

        # Two-tier row model:
        #   - SOCKET rows (kind absent / "socket"): bind one wired socket
        #     to a $variable. An optional template substitutes ONLY the
        #     row's OWN `$input_N` — rows resolve top-to-bottom, so an
        #     early row must not read a later socket's value.
        #   - GENERAL rows (kind "general"): durable, not tied to a
        #     socket. Survives socket disconnect/reconnect. Resolved
        #     AFTER all socket rows so its template can reference BOTH the
        #     raw sockets (`$input_N`) AND the variables produced by the
        #     socket rows (`$test`).
        socket_rows: list[dict] = []
        general_rows: list[dict] = []
        for row in rows_list:
            if not isinstance(row, dict):
                continue
            if row.get("kind") == "general":
                general_rows.append(row)
            else:
                socket_rows.append(row)

        # ── Pass 1: socket rows (existing order) ──────────────────────
        for row in socket_rows:
            if not row.get("enabled", False):
                continue
            stripped = _validated_binding(row)
            if stripped is None:
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
                # against ONLY this row's OWN socket. Other `$input_M`
                # refs are out of scope (left as literal `$input_M`, same
                # as any unknown ref) — top-to-bottom resolution means an
                # early socket row must not read a later socket. To
                # compose multiple sockets, use a GENERAL row instead.
                own_slot: dict[str, Any] = (
                    {slot_name: slot_values.get(slot_name, "")}
                    if isinstance(slot_name, str)
                    else {}
                )
                stored = _render_template(template_str, own_slot)
                trace_type = "str(template)"
            ctx[stripped] = stored
            is_internal = bool(row.get("internal", False))
            if is_internal:
                internal_keys.add(stripped)
            _emit_trace(stripped, stored, trace_type, is_internal)

        # ── Pass 2: general rows (in order, after all socket rows) ────
        # A general row resolves its template against `merged`: every
        # non-`__`-prefixed ctx var written so far (socket-row bindings +
        # any earlier general-row binding) overlaid with the raw sockets.
        # So `$test` (a socket-row output) AND `$input_0` (a raw socket)
        # both resolve. Processing in order lets a later general row read
        # an earlier general row's binding.
        for row in general_rows:
            if not row.get("enabled", False):
                continue
            stripped = _validated_binding(row)
            if stripped is None:
                continue
            template_raw = row.get("template", None)
            template_str = (
                template_raw.strip()
                if isinstance(template_raw, str) and template_raw.strip()
                else ""
            )
            # A general row has no socket — it needs a non-empty template
            # to produce anything. Skip otherwise.
            if not template_str:
                continue
            merged: dict[str, Any] = {
                k: v for k, v in ctx.items() if not k.startswith("__")
            }
            merged.update(slot_values)
            stored = _render_template(template_str, merged)
            ctx[stripped] = stored
            is_internal = bool(row.get("internal", False))
            if is_internal:
                internal_keys.add(stripped)
            _emit_trace(stripped, stored, "str(template)", is_internal)

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
