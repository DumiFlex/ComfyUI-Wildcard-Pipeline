"""ContextInject node — maps arbitrary string inputs to pipeline context variables."""

from __future__ import annotations

import json
import logging
from typing import Any

from comfy_api.latest import io

from .pipeline_node import PipelineContext

logger = logging.getLogger(__name__)


@io.comfytype(io_type="WP_INJECT_CONFIG")
class InjectConfig:
    """Custom widget type for inject config — sends WP_INJECT_CONFIG to frontend."""

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


CONTEXT_INJECT_MAX_INPUTS = 5
CONTEXT_INJECT_SLOT_NAMES = [
    f"input_{i}" for i in range(1, CONTEXT_INJECT_MAX_INPUTS + 1)
]


class ContextInject(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="WP_ContextInject",
            display_name="Context Inject",
            category="Wildcard Pipeline",
            description="Injects arbitrary string values into the pipeline context as named variables",
            inputs=[
                PipelineContext.Input("pipeline_context", optional=True),
                io.Autogrow.Input(
                    "inputs",
                    template=io.Autogrow.TemplateNames(
                        input=io.String.Input("value", force_input=True, optional=True),
                        names=CONTEXT_INJECT_SLOT_NAMES,
                        min=1,
                    ),
                ),
                InjectConfig.Input(
                    "inject_config",
                    default="{}",
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
        pipeline_context: dict[str, Any] | None = None,
        inputs: dict[str, str | None] | None = None,
        inject_config: str = "{}",
    ) -> io.NodeOutput:
        ctx: dict[str, Any] = {}

        if pipeline_context:
            for key, value in pipeline_context.items():
                ctx[key] = value

        try:
            mapping: dict[str, str] = json.loads(inject_config)
        except (json.JSONDecodeError, TypeError):
            mapping = {}

        slot_values = inputs or {}

        for slot_name, slot_value in slot_values.items():
            if slot_value is None:
                continue
            var_name = mapping.get(slot_name, "").strip()
            if not var_name:
                continue
            var_name = var_name.lstrip("$")
            if not var_name:
                continue
            if var_name in ctx and not var_name.startswith("__"):
                logger.warning(
                    "Variable '$%s' already exists in context — overwriting",
                    var_name,
                )
            ctx[var_name] = str(slot_value)

        return io.NodeOutput(ctx)
