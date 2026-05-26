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
        return io.NodeOutput(parse_float(text, index, default))
