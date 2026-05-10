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

        # Flatten the typed ContextPayload into a single dict the
        # frontend `DebugViewer.vue` consumes. User-facing variables
        # sit at the top level (matching the on-the-wire ctx shape so
        # the snapshot tab reads naturally). Engine-internal keys —
        # `__wp_trace__`, `__wp_warnings__`, `__wp_picks__`,
        # `__wp_node_seed__`, `__wp_upstream_debug__` — are also at
        # top level (with the leading `__` so the snapshot tab's
        # default filter strips them out, while the dedicated
        # trace/picks/warnings tabs read them explicitly).
        flat: dict = dict(context.context)
        debug = context.debug or {}
        internals = context.internals or {}

        if debug.get("__wp_trace__"):
            flat["__wp_trace__"] = debug["__wp_trace__"]
        if debug.get("__wp_warnings__"):
            flat["__wp_warnings__"] = debug["__wp_warnings__"]
        if internals.get("__wp_picks__"):
            flat["__wp_picks__"] = internals["__wp_picks__"]
        if "node_seed" in debug:
            flat["__wp_node_seed__"] = debug["node_seed"]

        snapshot = json.dumps(flat, default=str, indent=2)
        return io.NodeOutput(ui={"wp_debug_snapshot": [snapshot]})
