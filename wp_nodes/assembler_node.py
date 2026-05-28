"""WP_PromptAssembler — fills $var placeholders from a PipelineContext."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.context import strip_internals
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
                PipelineContext.Input(
                    "context",
                    tooltip=(
                        "The resolved $variable context from any upstream "
                        "WP Context / Loop / Injector chain. Required — "
                        "without it the template can't resolve any $vars."
                    ),
                ),
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
                    tooltip=(
                        "Your prompt template. Type free text and insert "
                        "$variable names where the upstream Context's "
                        "values should appear. Inline {a|b|c} picks render "
                        "verbatim here — produce randomness in a seeded "
                        "module instead."
                    ),
                ),
            ],
            outputs=[io.String.Output("prompt")],
        )

    @classmethod
    def execute(cls, context, template):
        # Build the render context from the socket payload. `context.context`
        # holds user-named vars including those flagged internal (the
        # PIPELINE_CONTEXT socket now propagates internal vars across
        # nodes so Combine / Derivation downstream of an internal var
        # can still read it). `__wp_internal_flags__` rides in
        # `context.internals` as a cross-node-survivor so this assembler
        # can re-apply the user's "hide from prompt" intent. Merge the
        # flag map back into the render dict, then strip_internals
        # drops both engine `__` keys AND user-flagged internal vars
        # before resolution — net effect: `$var` for an internal var
        # never substitutes in the rendered prompt.
        render_ctx = dict(context.context)
        flags = (context.internals or {}).get("__wp_internal_flags__")
        if isinstance(flags, dict):
            render_ctx["__wp_internal_flags__"] = flags
        resolved = resolve_variables(template, strip_internals(render_ctx))
        return io.NodeOutput(resolved)
