"""WP_PromptAssembler — fills $var placeholders from a PipelineContext."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import negatives
from engine.context import strip_internals, with_resolver_tables
from engine.template import resolve_variables, resolve_variables_raw
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
                    # Render this input with our own editor instead of the
                    # stock textarea, WITHOUT changing what the socket
                    # accepts. `widget_type=` would do the first and break
                    # the second: `WidgetInput.get_io_type` returns
                    # widget_type when set, so the socket would stop being
                    # STRING and no upstream STRING output could feed it.
                    # `extra_dict` is merged last in `Input.as_dict` and
                    # never consulted by `get_io_type`, so the spec carries
                    # `widgetType` for the frontend's widget lookup while
                    # the socket stays STRING. The value is still a plain
                    # string in `widgets_values`, so workflows saved before
                    # this change load their template unchanged.
                    extra_dict={"widgetType": "WP_TEMPLATE_EDITOR"},
                ),
                # Send-to-negative. Declared AFTER `template` so a workflow
                # saved before it existed still maps its one widget value to
                # the template; the missing value takes this default.
                io.String.Input(
                    "negative_template",
                    multiline=True,
                    default="",
                    optional=True,
                    placeholder="$negatives",
                    tooltip=(
                        "Your negative prompt. $negatives is where the "
                        "negatives of the variables the prompt used go. "
                        "Empty = just those words; without $negatives they "
                        "are added at the end."
                    ),
                    # Same editor and same STRING socket as `template`.
                    extra_dict={"widgetType": "WP_TEMPLATE_EDITOR"},
                ),
            ],
            # `prompt` stays at index 0 so existing links keep their slot.
            outputs=[
                io.String.Output("prompt"),
                # The negative template filled with the negatives of every
                # variable the prompt rendered.
                io.String.Output("negative"),
            ],
        )

    @classmethod
    def execute(cls, context, template, negative_template=""):
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
        # The accessor tables (`__wp_axes__`, `__wp_picks__`) AND the
        # internal-flag map ride on `context.internals`, NOT `context.context`:
        # every one is `__`-prefixed, so the socket boundary
        # (`strip_engine_internals` in `build_payload`) drops them from the
        # user-facing payload and re-files the cross-node subset under
        # `internals`. Merge that whole carve-out back in before resolving so
        # `strip_internals` can re-apply the hide-from-prompt filter AND
        # `with_resolver_tables` can re-attach the `$var.AXIS` / `$var.N`
        # tables. Pre-fix only `__wp_internal_flags__` was merged, so
        # `$outfit.SHOES` rendered "" across the socket even though the
        # identical read resolved one node upstream (the combine surface,
        # which runs before the socket strips the table).
        render_ctx.update(context.internals or {})
        resolve_ctx = with_resolver_tables(strip_internals(render_ctx), render_ctx)
        reads: list = []
        resolved = resolve_variables(template, resolve_ctx, reads=reads)
        negative = assemble_negative(
            render_ctx, reads, negative_template or "",
            lambda text: resolve_variables_raw(text, resolve_ctx),
        )
        return io.NodeOutput(resolved, negative)


def assemble_negative(render_ctx, reads, negative_template, resolve_raw) -> str:
    """The negative output: the negatives of the variables the positive
    template rendered (follow usage), deduped tag by tag, placed into the
    negative template at `$negatives`. Variables in the negative template add
    their text but never their own negatives."""
    entries = negatives.entries_for_reads(render_ctx, reads)
    collected = negatives.join_unique(str(e.get("text", "")) for e in entries)
    return negatives.render_negative(negative_template, collected, resolve_raw)
