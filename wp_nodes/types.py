"""Custom ComfyUI socket type ``PIPELINE_CONTEXT`` and widget-only types."""

import json
from dataclasses import dataclass, field
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]
from comfy_api.latest._io import (  # pyright: ignore[reportMissingImports]
    ComfyTypeIO,
    comfytype,
)

from engine.context import strip_internals
from engine.modules import Module, module_from_dict


@dataclass(frozen=True)
class ContextPayload:
    """Value carried across ``PIPELINE_CONTEXT`` sockets.

    ``context`` holds user-facing variables (internals stripped). ``debug``
    carries run metadata (upstream snapshot, seed, trace) for the debug node.
    """

    context: dict[str, Any] = field(default_factory=dict)
    debug: dict[str, Any] = field(default_factory=dict)


@comfytype(io_type="PIPELINE_CONTEXT")
class PipelineContext(ComfyTypeIO):
    """Socket type carrying ContextPayload across nodes."""

    Type = ContextPayload


@comfytype(io_type="WP_CONTEXT_MODULES")
class ContextModulesInput:
    """Widget-only custom type — frontend binds ``getCustomWidgets["WP_CONTEXT_MODULES"]``."""

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


@comfytype(io_type="WP_DEBUG_VIEWER")
class DebugViewerInput:
    """Widget-only custom type — frontend binds ``getCustomWidgets["WP_DEBUG_VIEWER"]``."""

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
                None,
                None,
                extra_dict,
                raw_link,
                advanced,
            )


def deserialize_modules(payload: str) -> list[Module]:
    """Parse the widget JSON payload into a list of engine module dataclasses.

    Raises ``ValueError`` on malformed JSON or a non-dict root.
    """
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid modules JSON: {exc.msg}") from exc

    if not isinstance(data, dict):
        raise ValueError(
            f"Modules payload must be a JSON object, got {type(data).__name__}"
        )

    raw_modules = data.get("modules") or []
    return [module_from_dict(entry) for entry in raw_modules]


def build_payload(
    ctx: dict[str, Any],
    upstream_debug: dict[str, Any],
    seed: int,
) -> ContextPayload:
    """Construct the socket-boundary payload. Strips internals from context."""
    return ContextPayload(
        context=strip_internals(ctx),
        debug={
            "upstream": upstream_debug,
            "node_seed": seed,
            "trace": ctx.get("__wp_trace__", []),
        },
    )
