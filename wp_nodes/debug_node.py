"""WP_Debug — terminal node that emits the PipelineContext for UI inspection."""

import json

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from wp_nodes.types import DebugViewerInput, PipelineContext


class WPDebug(io.ComfyNode):
    """Inspect the context at any point in the chain. Terminal output node."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Debug",
            display_name="WP Debug",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                DebugViewerInput.Input("viewer", socketless=True),
            ],
            outputs=[],
            is_output_node=True,
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, context, viewer):
        del viewer  # accepted for widget binding parity; no runtime use
        snapshot = json.dumps(
            {"context": context.context, "debug": context.debug},
            default=str,
            indent=2,
        )
        return io.NodeOutput(ui={"wp_debug_snapshot": [snapshot]})
