"""WP_Debug — terminal node that emits the PipelineContext for UI inspection."""

import json

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.syntax.types import ListVar
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
                PipelineContext.Input(
                    "context",
                    tooltip=(
                        "The resolved $variable context from any upstream "
                        "WP Context / Loop / Injector chain. Required — "
                        "without it the node has nothing to inspect."
                    ),
                ),
                DebugViewerInput.Input("wp_viewer", socketless=True),
            ],
            outputs=[],
            is_output_node=True,
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, context, wp_viewer):
        del wp_viewer  # accepted for widget binding parity; no runtime use

        # Flatten the typed ContextPayload into a single dict the
        # frontend `DebugViewer.vue` consumes. User-facing variables sit at
        # the top level; everything else rides on `__`-prefixed keys the
        # viewer reads by name (see `src/components/debug/debug-model.ts`):
        #   __wp_trace__ / __wp_warnings__  every module + injector row and
        #                                   warning in the chain
        #   __wp_picks__                    wildcard picks, by module id
        #   __wp_ref_log__                  nested @{} picks, by owner uid
        #   __wp_nodes__                    one {node_id, seed} per Context
        #   __wp_internal_flags__           variables marked internal
        #   __wp_axes__                     rolled accepts-axis tags
        #   __wp_constraint_hits__          targets each constraint reached
        #   __wp_multi__                    multi-pick variables' items
        #   __wp_node_seed__ / __wp_loop_index__
        # `__wp_debug_version__` lets the viewer tell this shape from a
        # cached snapshot written by an older build.
        flat: dict = {}
        multi: dict = {}
        for key, value in (context.context or {}).items():
            if isinstance(value, ListVar):
                multi[key] = {"items": list(value.items), "sep": value.sep}
            flat[key] = value
        debug = context.debug or {}
        internals = context.internals or {}

        flat["__wp_debug_version__"] = 2
        for key in ("__wp_trace__", "__wp_warnings__", "__wp_ref_log__", "__wp_nodes__"):
            if debug.get(key):
                flat[key] = debug[key]
        for key in (
            "__wp_picks__",
            "__wp_internal_flags__",
            "__wp_axes__",
            "__wp_constraint_hits__",
        ):
            if internals.get(key):
                flat[key] = internals[key]
        if "__wp_loop_index__" in internals:
            flat["__wp_loop_index__"] = internals["__wp_loop_index__"]
        if multi:
            flat["__wp_multi__"] = multi
        if "node_seed" in debug:
            flat["__wp_node_seed__"] = debug["node_seed"]

        snapshot = json.dumps(flat, default=str, indent=2)
        return io.NodeOutput(ui={"wp_debug_snapshot": [snapshot]})
