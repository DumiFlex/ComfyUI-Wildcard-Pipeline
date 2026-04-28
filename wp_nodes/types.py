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


def deserialize_node_input(
    raw: "dict[str, Any] | str | None",
) -> "tuple[list[dict[str, Any]], dict[str, Any], list[str]]":
    """Parse a WP_Context node's ``modules`` widget value into the three
    parallel concerns the engine needs: an executable module list, a
    catalog snapshot dict, and the user's explicit pick order.

    Spec §4.4. Backwards-compat: old workflows have no ``snapshots`` /
    ``pickOrder`` fields — those default to empty (catalog stays {}, no
    @{} resolution, raw token leaks in output, current behavior).

    Returns the modules portion as a ``list[dict]`` rather than the typed
    ``list[Module]`` that ``deserialize_modules`` produces. Two reasons:
    the legacy converter ``module_from_dict`` requires an ``id`` field
    and only knows how to type ``fixed_values`` (Module is currently a
    TypeAlias for FixedValueModule), so SPA-shaped wildcard / combine /
    derivation entries would all be rejected. ``PipelineEngine.run``
    already accepts dicts directly (engine/pipeline.py:57) — coercing
    them through ``coerce_legacy_module`` at execute time — so the raw-
    dict path is the safe one for the new SPA snapshot shape.

    Robust to malformed input: any failure path returns ``([], {}, [])``
    so graph runs never crash on a broken widget value.
    """
    if raw is None:
        return [], {}, []
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception:
            return [], {}, []
    else:
        data = raw
    if not isinstance(data, dict):
        return [], {}, []

    raw_modules = data.get("modules")
    modules: list[dict[str, Any]] = (
        list(raw_modules) if isinstance(raw_modules, list) else []
    )
    snapshots_raw = data.get("snapshots")
    snapshots: dict[str, Any] = (
        snapshots_raw if isinstance(snapshots_raw, dict) else {}
    )
    pick_order_raw = data.get("pickOrder")
    pick_order: list[str] = (
        pick_order_raw if isinstance(pick_order_raw, list) else []
    )
    return modules, snapshots, pick_order


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
