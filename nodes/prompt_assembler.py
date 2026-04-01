"""PromptAssembler node — resolves a template string using pipeline context."""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io

from .pipeline_node import PipelineContext


class PromptAssembler(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_PromptAssembler",
            display_name="Prompt Assembler",
            category="Wildcard Pipeline",
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
        from ..engine.pipeline import resolve_variables

        prompt = resolve_variables(template, pipeline_context)
        return io.NodeOutput(prompt)
