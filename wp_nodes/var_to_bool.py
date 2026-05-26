"""WP_VarToBool — reads a named $var from PipelineContext, emits a BOOLEAN.

Parsing rule: tokenize the var's value on ``[\\s,;|/]+``, match each
token case-insensitively against {true,yes,on,1} (→ True) or
{false,no,off,0} (→ False). Tokens that match neither are skipped (do
NOT consume an index slot — so ``"1.5"`` is invisible to the bool
parser). Index selects the Nth matching token; out-of-range falls back
to ``default``.
"""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.converters import lookup_var, parse_bool
from wp_nodes.types import PipelineContext, VarPickerInput


class WPVarToBool(io.ComfyNode):
    """PipelineContext $var → BOOLEAN."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_VarToBool",
            display_name="WP Var → Bool",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                VarPickerInput.Input("var_name", socketless=True),
                io.Int.Input("index", default=0, min=0, max=999),
                io.Boolean.Input("default", default=False),
            ],
            outputs=[io.Boolean.Output("value")],
            not_idempotent=False,
        )

    @classmethod
    def execute(cls, context, var_name, index, default):
        text = lookup_var(context, var_name)
        value = parse_bool(text, index, default)
        a = parse_bool(text, index, True)
        b = parse_bool(text, index, False)
        matched = a == b
        # See WP_VarToInt for the `wp_varpicker_*` UI-payload rationale.
        return io.NodeOutput(
            value,
            ui={
                "wp_varpicker_source": [text],
                "wp_varpicker_parsed": [str(value) if matched else None],
                "wp_varpicker_default": [str(default)],
            },
        )
