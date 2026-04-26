"""WP_Context — runs a module list and emits a PipelineContext payload."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.pipeline import PipelineEngine
from wp_nodes.types import (
    ContextModulesInput,
    PipelineContext,
    build_payload,
    deserialize_modules,
)


class WPContext(io.ComfyNode):
    """Context node: runs an ordered list of modules, emits PipelineContext."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Context",
            display_name="WP Context",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("upstream", optional=True),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                ),
                ContextModulesInput.Input("modules", socketless=True),
            ],
            outputs=[PipelineContext.Output("context")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, seed, modules, upstream=None):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}

        module_list = deserialize_modules(modules)
        ctx: dict = dict(upstream_ctx)
        ctx = PipelineEngine().run(module_list, ctx=ctx, seed=int(seed))

        payload = build_payload(ctx, upstream_debug=upstream_debug, seed=int(seed))
        return io.NodeOutput(payload)
