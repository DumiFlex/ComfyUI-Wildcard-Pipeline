"""WP_VarToInt — reads a named $var from PipelineContext, emits an INT.

Parsing rule: Nth signed-integer substring match from the var's value
(``-?\\d+`` regex). Out-of-range index, missing var, or unparseable
text all fall back to the ``default`` widget value.
"""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.converters import lookup_var, parse_int
from wp_nodes.types import PipelineContext, VarPickerInput


class WPVarToInt(io.ComfyNode):
    """PipelineContext $var → INT."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_VarToInt",
            display_name="WP Var → Int",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                VarPickerInput.Input("var_name", socketless=True),
                io.Int.Input("index", default=0, min=0, max=999),
                io.Int.Input(
                    "default",
                    default=0,
                    min=-0x7FFFFFFFFFFFFFFF,
                    max=0x7FFFFFFFFFFFFFFF,
                ),
            ],
            outputs=[io.Int.Output("value")],
            # Pure function of inputs — let ComfyUI cache outputs across runs.
            not_idempotent=False,
        )

    @classmethod
    def execute(cls, context, var_name, index, default):
        text = lookup_var(context, var_name)
        return io.NodeOutput(parse_int(text, index, default))
