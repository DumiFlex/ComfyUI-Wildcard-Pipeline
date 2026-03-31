"""WildcardPipeline node — runs pipeline modules and outputs PIPELINE_CONTEXT."""

from __future__ import annotations

import json
import time
from typing import Any

from comfy_api.latest import io


# Custom type for pipeline context — a dict accumulating resolved variables
PipelineContext = io.Custom("PIPELINE_CONTEXT")


class WildcardPipeline(io.ComfyNode):
    """Contains an ordered list of pipeline modules (configured via Vue widget).

    Modules are Vue component rows rendered inside a DOM widget. The entire
    module list serialises to a JSON string stored in a hidden STRING input.
    Python reads that JSON and runs the pipeline engine at execution time.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_WildcardPipeline",
            display_name="Wildcard Pipeline",
            category="wildcard-pipeline",
            description="Weighted wildcard sampling with chained context passing",
            not_idempotent=True,  # safety net — always re-execute for random sampling
            inputs=[
                PipelineContext.Input("pipeline_context", optional=True),
                io.String.Input(
                    "pipeline_name",
                    default="Pipeline",
                ),
                # Module config — serialised JSON from the Vue DOM widget.
                # The default STRING widget is replaced by the Vue widget via
                # getCustomWidgets() in the frontend extension.
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
        """Always return a unique value to bust the cache (random sampling)."""
        return time.time()

    @classmethod
    def execute(
        cls,
        pipeline_name: str = "Pipeline",
        module_config: str = "[]",
        pipeline_context: dict[str, Any] | None = None,
    ) -> io.NodeOutput:
        from ..engine.pipeline import PipelineEngine

        ctx = dict(pipeline_context) if pipeline_context else {}
        modules = json.loads(module_config)
        engine = PipelineEngine()
        ctx = engine.run(modules, ctx)
        return io.NodeOutput(ctx)
