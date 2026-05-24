"""WP_PromptCleaner — V3 node wrapping the cleaner engine.

Slots:
  - prompt   : STRING (required, multiline)
  - context  : PIPELINE_CONTEXT (optional) — unlocks WP-aware rules
                 (wp_dedupe / null_slot / dangling_var / reorder)
  - cleaner  : WP_CLEANER widget (config JSON: mode, intensity,
                 rules_override, blocklist, preset_id?)

Output:
  - prompt   : STRING

The engine pipeline does the work. This node just adapts the
PipelineContext payload into a CleanerCtx dataclass + parses the
widget JSON config, then calls PromptCleaner.run().
"""

import json
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.cleaner.pipeline import PromptCleaner
from engine.cleaner.types import CleanerCtx
from wp_nodes.types import CleanerWidgetInput, ContextPayload, PipelineContext


def _build_cleaner_ctx(
    pipeline_context: ContextPayload | dict[str, Any] | None,
) -> CleanerCtx | None:
    """Adapt a PIPELINE_CONTEXT payload into the engine's CleanerCtx.

    Accepts a typed ContextPayload (live socket value) OR a plain dict
    shaped like ``{__wp_picks__, __wp_constraints__, __wp_warnings__}``
    (test fixtures + legacy callers). Returns None when context is
    absent so WP-aware rules silently skip.
    """
    if pipeline_context is None:
        return None
    if isinstance(pipeline_context, ContextPayload):
        internals = pipeline_context.internals or {}
        debug = pipeline_context.debug or {}
        picks = internals.get("__wp_picks__")
        constraints = internals.get("__wp_constraints__")
        warnings = debug.get("__wp_warnings__")
    else:
        picks = pipeline_context.get("__wp_picks__")
        constraints = pipeline_context.get("__wp_constraints__")
        warnings = pipeline_context.get("__wp_warnings__")
    return CleanerCtx(
        picks=picks if isinstance(picks, dict) else {},
        constraints=constraints if isinstance(constraints, list) else [],
        warnings=warnings if isinstance(warnings, list) else [],
    )


def _parse_config(raw: dict[str, Any] | str | None) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    return raw


class WPPromptCleaner(io.ComfyNode):
    """Rule-based prompt cleaner with optional WP context awareness."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_PromptCleaner",
            display_name="WP Prompt Cleaner",
            category="wildcard-pipeline",
            inputs=[
                io.String.Input("prompt", multiline=True, default=""),
                PipelineContext.Input("context", optional=True),
                CleanerWidgetInput.Input("cleaner", socketless=True, default="{}"),
            ],
            outputs=[io.String.Output("prompt")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, prompt, context=None, cleaner="{}"):
        cfg = _parse_config(cleaner)
        ctx = _build_cleaner_ctx(context)
        result = PromptCleaner().run(prompt, cfg, ctx)
        return io.NodeOutput(result["text"])
