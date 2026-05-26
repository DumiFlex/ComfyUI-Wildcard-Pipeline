"""WP_VarToFloat — reads a named $var from PipelineContext, emits a FLOAT.

Parsing rule: Nth signed-float substring match from the var's value
(``-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?``). Integers match too, so
``"1920"`` yields ``1920.0``. Fallback path identical to WPVarToInt.
"""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.converters import lookup_var, parse_float
from wp_nodes.types import PipelineContext, VarPickerInput


class WPVarToFloat(io.ComfyNode):
    """PipelineContext $var → FLOAT."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_VarToFloat",
            display_name="WP Var → Float",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                VarPickerInput.Input("var_name", socketless=True),
                io.Int.Input("index", default=0, min=0, max=999),
                io.Float.Input(
                    "default",
                    default=0.0,
                    min=-1.0e38,
                    max=1.0e38,
                    step=0.01,
                ),
            ],
            outputs=[io.Float.Output("value")],
            not_idempotent=False,
        )

    @classmethod
    def execute(cls, context, var_name, index, default):
        text = lookup_var(context, var_name)
        value = parse_float(text, index, default)
        a = parse_float(text, index, 0.0)
        b = parse_float(text, index, 1.0)
        matched = a == b
        # See WP_VarToInt for the `wp_varpicker_*` UI-payload rationale
        # — engine-resolved source + parsed output feeds the widget's
        # "last execute" strip so wildcard-template vars show the truth.
        return io.NodeOutput(
            value,
            ui={
                "wp_varpicker_source": [text],
                "wp_varpicker_parsed": [str(value) if matched else None],
                "wp_varpicker_default": [str(default)],
            },
        )
