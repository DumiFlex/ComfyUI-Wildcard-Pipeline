"""WildcardPipeline node — runs pipeline modules and outputs PIPELINE_CONTEXT."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from comfy_api.latest import io

logger = logging.getLogger(__name__)

PipelineContext = io.Custom("PIPELINE_CONTEXT")


class WildcardPipeline(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_WildcardPipeline",
            display_name="Wildcard Pipeline",
            category="wildcard-pipeline",
            description="Weighted wildcard sampling with chained context passing",
            not_idempotent=True,
            inputs=[
                PipelineContext.Input("pipeline_context", optional=True),
                io.String.Input(
                    "pipeline_name",
                    default="Pipeline",
                ),
                io.String.Input(
                    "module_config",
                    default="[]",
                    multiline=True,
                ),
            ],
            outputs=[
                PipelineContext.Output(display_name="PIPELINE_CONTEXT"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs: Any) -> float:
        return time.time()

    @classmethod
    def execute(
        cls,
        pipeline_name: str = "Pipeline",
        module_config: str = "[]",
        pipeline_context: dict[str, Any] | None = None,
    ) -> io.NodeOutput:
        from ..engine.pipeline import PipelineEngine
        from .sources import resolve_sources

        ctx: dict[str, Any] = {}

        if pipeline_context:
            for key, value in pipeline_context.items():
                if key in ctx and not key.startswith("__"):
                    logger.warning(
                        "Variable '$%s' already exists in context — overwriting",
                        key,
                    )
                ctx[key] = value

        modules = json.loads(module_config)
        modules = resolve_sources(modules)

        engine = PipelineEngine()
        ctx = engine.run(modules, ctx)
        return io.NodeOutput(ctx)
