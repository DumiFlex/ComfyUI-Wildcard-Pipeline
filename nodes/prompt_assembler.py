"""PromptAssembler node — resolves a template string using pipeline context."""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io

from .pipeline_node import PipelineContext


class PromptAssembler(io.ComfyNode):
    """Terminal node that receives PIPELINE_CONTEXT and resolves a template
    string into the final prompt by substituting $variables.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_PromptAssembler",
            display_name="Prompt Assembler",
            category="wildcard-pipeline",
            description="Resolves a template string using pipeline context variables",
            inputs=[
                PipelineContext.Input("pipeline_context"),
                io.String.Input(
                    "template",
                    default="",
                    multiline=True,
                    placeholder="e.g. $character in $environment, $lighting atmosphere",
                ),
            ],
            outputs=[
                io.String.Output(display_name="prompt"),
            ],
        )

    @classmethod
    def execute(
        cls,
        pipeline_context: dict[str, Any],
        template: str = "",
    ) -> io.NodeOutput:
        prompt = template
        for key, value in pipeline_context.items():
            if key.startswith("__"):
                continue  # skip internal keys
            prompt = prompt.replace(f"${key}", str(value))
        return io.NodeOutput(prompt)
