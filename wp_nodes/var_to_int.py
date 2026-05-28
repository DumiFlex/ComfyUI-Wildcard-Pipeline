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
                PipelineContext.Input(
                    "context",
                    tooltip=(
                        "The resolved $variable context from any upstream "
                        "WP Context / Loop / Injector chain. Required — "
                        "without it the node has no variables to read."
                    ),
                ),
                VarPickerInput.Input("wp_var_name", socketless=True),
                io.Int.Input(
                    "index",
                    default=0,
                    min=0,
                    max=999,
                    tooltip=(
                        "Which number in the value to extract when multiple "
                        "are present (0 = first)."
                    ),
                ),
                io.Int.Input(
                    "default",
                    default=0,
                    min=-0x7FFFFFFFFFFFFFFF,
                    max=0x7FFFFFFFFFFFFFFF,
                    tooltip=(
                        "Value to use when the variable is missing or the "
                        "index is out of range. The node never errors — it "
                        "falls back to this."
                    ),
                ),
            ],
            outputs=[io.Int.Output("value")],
            # Pure function of inputs — let ComfyUI cache outputs across runs.
            not_idempotent=False,
        )

    @classmethod
    def execute(cls, context, wp_var_name, index, default):
        text = lookup_var(context, wp_var_name)
        value = parse_int(text, index, default)
        # Detect "fell back to default" via sentinel-default trick: run
        # parser twice with distinct defaults; if both return the same
        # value the parser hit a real match (defaults never read). If
        # they differ, the parser returned each default → fallback path.
        # Same trick the TS preview uses for parse_bool. Robust against
        # `parse_int("0 1 2", 0, 0) → 0` looking like a fallback.
        a = parse_int(text, index, 0)
        b = parse_int(text, index, 1)
        matched = a == b
        # `wp_varpicker_*` UI payload feeds the widget's "last execute"
        # strip. Static client-side preview would lie for wildcard
        # template vars (e.g. `{1|2|3}` parses to `1` while the engine
        # rolls a real pick) — sending the resolved source + parsed
        # output back from execute() gives the user the truth.
        return io.NodeOutput(
            value,
            ui={
                "wp_varpicker_source": [text],
                "wp_varpicker_parsed": [str(value) if matched else None],
                "wp_varpicker_default": [str(default)],
            },
        )
