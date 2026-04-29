"""WP_PromptAssembler — fills $var placeholders from a PipelineContext."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.template import resolve_variables
from wp_nodes.types import PipelineContext


class WPPromptAssembler(io.ComfyNode):
    """Template-fills $var placeholders using the incoming PipelineContext."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_PromptAssembler",
            display_name="WP Prompt Assembler",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                io.String.Input(
                    "template",
                    multiline=True,
                    default="",
                    # Placeholder example shown only while the textarea
                    # is empty — the workflow JSON stores no template
                    # by default, so re-creating the node leaves it
                    # blank instead of pre-populating prose users
                    # immediately have to delete.
                    placeholder="A $style portrait of $subject",
                ),
            ],
            outputs=[io.String.Output("prompt")],
        )

    @classmethod
    def execute(cls, context, template):
        resolved = resolve_variables(template, context.context)
        return io.NodeOutput(resolved)
