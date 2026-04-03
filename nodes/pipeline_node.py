"""WildcardPipeline node — runs pipeline modules and outputs PIPELINE_CONTEXT."""

from __future__ import annotations

import json
import logging
import random
from typing import Any

from comfy_api.latest import io

logger = logging.getLogger(__name__)

PipelineContext = io.Custom("PIPELINE_CONTEXT")


@io.comfytype(io_type="WP_PIPELINE_CONFIG")
class PipelineModuleConfig:
    """Custom widget type for pipeline module config — sends WP_PIPELINE_CONFIG to frontend."""

    Type = str

    class Input(io.WidgetInput):
        def __init__(
            self,
            id: str,
            display_name: str | None = None,
            optional: bool = False,
            tooltip: str | None = None,
            lazy: bool | None = None,
            default: str | None = None,
            socketless: bool | None = None,
            extra_dict: dict[str, Any] | None = None,
            raw_link: bool | None = None,
            advanced: bool | None = None,
        ):
            super().__init__(
                id,
                display_name,
                optional,
                tooltip,
                lazy,
                default,
                socketless,
                None,  # widget_type
                None,  # force_input
                extra_dict,
                raw_link,
                advanced,
            )


class WildcardPipeline(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_WildcardPipeline",
            display_name="Wildcard Pipeline",
            category="Wildcard Pipeline",
            description="Weighted wildcard sampling with chained context passing",
            inputs=[
                PipelineContext.Input("pipeline_context", optional=True),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                ),
                PipelineModuleConfig.Input(
                    "module_config",
                    default="[]",
                    socketless=True,
                ),
            ],
            outputs=[
                PipelineContext.Output(display_name="PIPELINE_CONTEXT"),
            ],
        )

    @classmethod
    def execute(
        cls,
        seed: int = 0,
        module_config: str = "[]",
        pipeline_context: dict[str, Any] | None = None,
    ) -> io.NodeOutput:
        from ..engine.pipeline import PipelineEngine
        from .sources import resolve_sources

        ctx: dict[str, Any] = {}

        if pipeline_context:
            for key, value in pipeline_context.items():
                if key in ctx and not key.startswith("__"):
                    msg = f"Variable '${key}' already exists in context — overwriting"
                    logger.warning(msg)
                ctx[key] = value

        modules = json.loads(module_config)
        modules = resolve_sources(modules)

        ctx["__wp_node_seed__"] = seed
        rng = random.Random(seed)
        engine = PipelineEngine()
        ctx = engine.run(modules, ctx, rng=rng)

        return io.NodeOutput(ctx)
