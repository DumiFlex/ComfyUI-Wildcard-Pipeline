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


CONTEXT_INJECT_SLOT_NAMES = ["input_1", "input_2", "input_3"]


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
                *[
                    io.String.Input(name, force_input=True, optional=True)
                    for name in CONTEXT_INJECT_SLOT_NAMES
                ],
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
        inject_config: str = "{}",
        **kwargs: str | None,
    ) -> io.NodeOutput:
        ctx: dict[str, Any] = {}

        if pipeline_context:
            for key, value in pipeline_context.items():
                ctx[key] = value

        try:
            mapping: dict[str, str] = json.loads(inject_config)
        except (json.JSONDecodeError, TypeError):
            mapping = {}

        for slot_name in CONTEXT_INJECT_SLOT_NAMES:
            slot_value = kwargs.get(slot_name)
            if slot_value is None:
                continue
            var_name = mapping.get(slot_name, "").strip()
            if not var_name:
                continue
            var_name = var_name.lstrip("$")
            if not var_name:
                continue
            if var_name in ctx and not var_name.startswith("__"):
                msg = f"Variable '${var_name}' already exists in context — overwriting"
                logger.warning(msg)
            ctx[var_name] = str(slot_value)

        return io.NodeOutput(ctx)
