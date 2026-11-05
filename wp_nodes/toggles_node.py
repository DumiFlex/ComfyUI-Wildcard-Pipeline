"""WP_Toggles — one node for many on/off switches.

Each toggle writes ``"true"`` / ``"false"`` to its own internal variable, and
a pinned toggle also has a plain BOOLEAN output. ComfyUI V3 has no dynamic
outputs, so the schema declares the context plus :data:`MAX_OUTPUTS`
BOOLEANs; the frontend (``src/widgets/toggles.ts``) shows only the pinned ones
and each row's ``out`` says which slot it drives. ``execute`` always returns
the full tuple, so a slot the canvas hid reads ``False``.

Resolution (``needs`` links, Pick one) lives in ``engine/toggles.py``.
"""
from __future__ import annotations

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import negatives, template, toggles
from wp_nodes.types import PipelineContext, TogglesWidgetInput


class WPToggles(io.ComfyNode):
    """Chain source of on/off variables, plus a BOOLEAN per pinned toggle."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Toggles",
            display_name="WP Toggles",
            category="wildcard-pipeline",
            description=(
                "Several on/off switches in one node. Each writes $its_variable "
                "as true or false for rules to branch on, and can show a "
                "BOOLEAN output for switch nodes."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes after "
                        "this one see the toggle variables."
                    ),
                ),
                TogglesWidgetInput.Input(
                    "wp_toggles", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                *(
                    io.Boolean.Output(f"toggle_{i}")
                    for i in range(1, toggles.MAX_OUTPUTS + 1)
                ),
            ],
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_toggles: str = "",
    ):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        cfg, from_upstream = toggles.with_upstream(toggles.parse_config(wp_toggles), upstream_ctx)
        values = toggles.resolve(cfg)
        set_vars = {t.var for t in cfg.toggles if t.id in from_upstream}
        group = cfg.group_var if cfg.mode == "one" else ""
        if group in values and ("$" in values[group] or "{" in values[group]):
            # A pick's value may read upstream variables and the toggles' own.
            values[group] = template.resolve_variables(values[group], {**upstream_ctx, **values})

        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}
        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None

        ctx: dict = dict(upstream_ctx)
        ctx.update(values)

        out_internals = dict(upstream_internals)
        # A write replaces a variable's negatives (send-to-negative rule).
        neg_table = out_internals.get(negatives.NEG_KEY)
        if isinstance(neg_table, dict) and any(k in neg_table for k in values):
            out_internals[negatives.NEG_KEY] = {
                k: v for k, v in neg_table.items() if k not in values
            }
        # Toggle variables are for rules, never for the prompt: always
        # internal. The Pick one variable may be shown (`group_visible`).
        hidden_vars = [k for k in values if not (k == group and cfg.group_visible)]
        flags = dict(out_internals.get("__wp_internal_flags__") or {})
        flags.update({k: True for k in hidden_vars})
        if group and cfg.group_visible:
            flags.pop(group, None)
        if flags or "__wp_internal_flags__" in out_internals:
            out_internals["__wp_internal_flags__"] = flags
        traces = [
            {
                "node": "WP_Toggles",
                "binding": name,
                "internal": name in hidden_vars,
                "type": "pick" if name == group else "toggle",
                "value": value,
                **({"source": "upstream"} if name in set_vars else {}),
            }
            for name, value in values.items()
        ]
        warnings = [
            {"type": "toggles_problem", "severity": "warn", "message": f"WP Toggles: {msg}"}
            for msg in toggles.problems(cfg)
        ]
        if cfg.mode == "one" and not cfg.forced and len(cfg.upstream_on) > 1:
            names = [t.name for t in cfg.toggles if t.id in cfg.upstream_on]
            warnings.append({
                "type": "toggles_upstream_many", "severity": "warn",
                "message": (
                    f"WP Toggles: upstream turned on {', '.join(names)}; "
                    f"Pick one took the first, {names[0]}"
                ),
            })

        debug = dict(upstream_debug)
        if node_id is not None:
            for row in traces + warnings:
                row["node_id"] = str(node_id)
        if traces:
            debug["__wp_trace__"] = list(debug.get("__wp_trace__", [])) + traces
        if warnings:
            debug["__wp_warnings__"] = list(debug.get("__wp_warnings__", [])) + warnings

        return io.NodeOutput(
            PipelineContext.Type(context=ctx, debug=debug, internals=out_internals),
            *toggles.output_values(cfg),
        )
