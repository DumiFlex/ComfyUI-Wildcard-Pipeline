"""Custom ComfyUI socket type ``PIPELINE_CONTEXT`` and widget-only types."""

import json
from dataclasses import dataclass, field
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]
from comfy_api.latest._io import (  # pyright: ignore[reportMissingImports]
    ComfyTypeIO,
    comfytype,
)

from engine.context import strip_engine_internals
from engine.modules import Module, module_from_dict


@dataclass(frozen=True)
class ContextPayload:
    """Value carried across ``PIPELINE_CONTEXT`` sockets.

    ``context`` holds user-facing variables (internals stripped). ``debug``
    carries run metadata (upstream snapshot, seed, trace) for the debug node.

    ``internals`` is a deliberate carve-out for engine-internal state that
    MUST survive cross-node boundaries — currently `__wp_picks__` (so a
    downstream constraint-aware wildcard can read its source's pick from
    a wildcard that lived in an upstream Context) and `__wp_constraints__`
    (so a constraint registered upstream still applies to a downstream
    target wildcard). The standard `strip_internals` filter would drop
    these alongside trace/rng/etc; this field lets them travel without
    leaking into the user-facing `context` payload that the assembler
    consumes.
    """

    context: dict[str, Any] = field(default_factory=dict)
    debug: dict[str, Any] = field(default_factory=dict)
    internals: dict[str, Any] = field(default_factory=dict)


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


@comfytype(io_type="WP_INJECTOR_ROWS")
class InjectorRowsInput:
    """Widget-only custom type — frontend binds ``getCustomWidgets["WP_INJECTOR_ROWS"]``."""

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
    """Parse a WP_Context node's ``modules`` widget value.

    Returns ``(modules, catalog, pick_order)``:

      - ``modules``: ordered list of every entry the user has in
        the widget — wildcards, combines, derivations, constraints,
        pipelines, fixed_values, all in one list. Same shape SPA
        editors emit + ``PipelineEngine.run`` accepts.
      - ``catalog``: the wildcard subset of ``modules``, keyed by
        ``id`` (= 8-hex uuid), each value mapped back to the
        canonical ``SnapshotEntry`` shape the engine resolver
        consumes via ``ctx["__wp_catalog__"]``.
      - ``pick_order``: kept in the return signature for back-compat
        with existing callers; always empty under the unified model
        (the modules list itself preserves order).

    Returns the modules portion as a ``list[dict]`` rather than the
    typed ``list[Module]`` produced by ``deserialize_modules``. The
    legacy ``module_from_dict`` requires fields the SPA shape doesn't
    carry (and only knows how to type ``fixed_values``), so the raw-
    dict path is the safe one for the unified shape — the engine
    already coerces dicts at execute time.

    Robust to malformed input: any failure path returns
    ``([], {}, [])`` so graph runs never crash on a broken widget
    value.
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

    # Bundle enable-gate. `BundleInstance.enabled` used to cascade into
    # every child's `module.enabled` at toggle time, which destroyed each
    # child's individual on/off state every time the user disabled a
    # bundle. Now the bundle gate is a non-destructive overlay applied at
    # the engine boundary: child.instance.enabled stays whatever the user
    # set, and we AND it with the bundle's gate here so the engine
    # (which only knows about flat `modules[].enabled`) sees the
    # effective view without needing bundle awareness.
    #
    # Effective enabled = bundle.enabled AND every ancestor bundle's
    # enabled AND child.enabled. Tier-2 nesting walks one parent_uid
    # hop; the API cap forbids deeper chains so the loop terminates
    # in at most two steps.
    raw_bundles = data.get("bundles")
    bundle_enabled: dict[str, bool] = {}
    bundle_parent: dict[str, str | None] = {}
    if isinstance(raw_bundles, list):
        for b in raw_bundles:
            if not isinstance(b, dict):
                continue
            uid = b.get("_uid")
            if isinstance(uid, str):
                bundle_enabled[uid] = bool(b.get("enabled", True))
                parent = b.get("parent_uid")
                bundle_parent[uid] = parent if isinstance(parent, str) else None
    if bundle_enabled:
        def _bundle_chain_enabled(uid: str) -> bool:
            # Walk up parent_uid, return false on the first disabled ancestor.
            # Defensive depth cap (8) absorbs corrupt cycles even though
            # the API tier-2 rule keeps real chains at 1–2 hops.
            seen: set[str] = set()
            cur: str | None = uid
            depth = 0
            while cur is not None and cur not in seen and depth < 8:
                seen.add(cur)
                if bundle_enabled.get(cur, True) is False:
                    return False
                cur = bundle_parent.get(cur)
                depth += 1
            return True

        gated: list[dict[str, Any]] = []
        for m in modules:
            if not isinstance(m, dict):
                gated.append(m)
                continue
            origin = m.get("bundle_origin")
            if isinstance(origin, str) and not _bundle_chain_enabled(origin):
                # Shallow-clone so we don't mutate the workflow-state
                # row the SPA holds onto for undo / restore.
                gated.append({**m, "enabled": False})
            else:
                gated.append(m)
        modules = gated

    # Build the wildcard catalog from the modules list directly.
    # Filter by `type == "wildcard"` and synthesise a SnapshotEntry
    # per row keyed by `id`. Resolver looks up `ctx["__wp_catalog__"][uuid]`
    # and reads `entry["payload"]["options"]` — that's the only
    # contract this map needs to satisfy.
    catalog: dict[str, dict[str, Any]] = {}
    for m in modules:
        if not isinstance(m, dict):
            continue
        if m.get("type") != "wildcard":
            continue
        mid = m.get("id")
        if not isinstance(mid, str):
            continue
        payload = m.get("payload")
        if not isinstance(payload, dict):
            continue
        catalog[mid] = {
            "snapshot_version": 1,
            "uuid": mid,
            "type": "wildcard",
            "name": m.get("meta", {}).get("name") if isinstance(m.get("meta"), dict) else "",
            "payload": payload,
            "payload_hash": m.get("payload_hash") or "",
            "source": {"kind": "user"},
        }

    return modules, catalog, []


#: Internal ctx keys whose lifetime spans the full graph chain rather
#: than a single Context node. Pre-fix every `__`-prefixed key got
#: dropped at each socket boundary, so `__wp_picks__` (set when a
#: wildcard rolls) and `__wp_constraints__` (set when a constraint
#: module registers) didn't survive between nodes — a constraint in
#: Context B targeting a wildcard in Context C couldn't see the
#: source's pick recorded in Context A. Listed here explicitly so
#: future cross-node internals are an opt-in addition rather than a
#: default-leak.
_CROSS_NODE_INTERNAL_KEYS = (
    "__wp_picks__",
    "__wp_constraints__",
    # User-marked-internal vars propagate across nodes as regular keys
    # in `context`, but downstream PromptAssemblers need to know WHICH
    # of those are internal so they can skip them at render time. Carry
    # the flag map alongside picks/constraints so the next node's
    # PromptAssembler can call `strip_internals` and re-apply the filter.
    "__wp_internal_flags__",
)


def build_payload(
    ctx: dict[str, Any],
    upstream_debug: dict[str, Any],
    seed: int,
) -> ContextPayload:
    """Construct the socket-boundary payload. Strips internals from
    `context`, but carries the cross-node-internal subset on the
    dedicated `internals` field so the next node's execute can merge
    them back into its ctx before running its own pipeline.

    Trace + warnings accumulate across the chain in `debug.__wp_trace__` /
    `debug.__wp_warnings__` (cumulative-merge pattern matching the
    injector node) so a terminal WPDebug at the chain tail sees every
    module + injector contribution, not just the immediate upstream's.
    """
    internals = {
        key: ctx[key]
        for key in _CROSS_NODE_INTERNAL_KEYS
        if key in ctx
    }
    upstream_trace = upstream_debug.get("__wp_trace__", [])
    upstream_warnings = upstream_debug.get("__wp_warnings__", [])
    this_trace = ctx.get("__wp_trace__", [])
    this_warnings = ctx.get("__wp_warnings__", [])
    return ContextPayload(
        context=strip_engine_internals(ctx),
        debug={
            "upstream": upstream_debug,
            "node_seed": seed,
            "__wp_trace__": list(upstream_trace) + list(this_trace),
            "__wp_warnings__": list(upstream_warnings) + list(this_warnings),
        },
        internals=internals,
    )
