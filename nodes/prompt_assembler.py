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

        internal_vars = pipeline_context.get("__wp_internal_vars__", [])
        filtered_ctx = {
            k: v for k, v in pipeline_context.items() if k not in internal_vars
        }
        prompt = resolve_variables(template, filtered_ctx)
        return io.NodeOutput(prompt)
