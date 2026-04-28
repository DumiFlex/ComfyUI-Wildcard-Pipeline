"""PipelineEngine — runs ordered modules through engine/modules/dispatcher.

Manages per-run state (rng, warnings, trace) and delegates per-module
resolution to dispatcher.resolve_module. Pre-Phase-5 the pipeline routed
fixed_values directly; Phase 5 routes everything via dispatcher and threads
ctx.rng for deterministic randomness.
"""
from __future__ import annotations

import dataclasses
import logging
import random

from engine.context import Context
from engine.modules import Module
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import coerce_legacy_module

logger = logging.getLogger(__name__)


class PipelineEngine:
    """Runs an ordered list of modules against a context dict."""

    def run(
        self,
        modules: list[Module],
        ctx: Context | None = None,
        seed: int = 0,
    ) -> Context:
        """Execute modules top-to-bottom, mutating ctx, returning ctx."""
        ctx = {} if ctx is None else ctx
        ctx["__wp_node_seed__"] = seed
        ctx["__wp_rng__"] = random.Random(seed)
        ctx.setdefault("__wp_warnings__", [])
        ctx.setdefault("__wp_trace__", [])
        ctx.setdefault("__wp_internal_flags__", {})

        for index, module in enumerate(modules):
            # Normalise id/type/enabled reads to work for both dicts and objects.
            if isinstance(module, dict):
                _module_id = module.get("id", "")
                _module_type_raw = module.get("type", None) or ""
                _module_enabled = module.get("enabled", True)
            else:
                _module_id = getattr(module, "id", "")
                _module_type_raw = getattr(module, "type", None) or ""
                _module_enabled = getattr(module, "enabled", True)

            if not _module_enabled:
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "type": _module_type_raw,
                    "enabled": False,
                    "status": "skipped_disabled",
                    "writes": [],
                    "error": None,
                })
                continue

            module_type = _module_type_raw
            try:
                # coerce_legacy_module expects a dict; convert dataclasses or
                # duck-typed objects by reading known attrs via getattr.
                if dataclasses.is_dataclass(module) and not isinstance(module, type):
                    raw = dataclasses.asdict(module)  # type: ignore[arg-type]
                elif isinstance(module, dict):
                    raw = module
                else:
                    # Generic object: pull known snapshot keys via getattr so
                    # class-level attributes (common in tests) are visible.
                    raw = {
                        k: getattr(module, k)
                        for k in (
                            "id", "type", "enabled", "payload", "entries",
                            "meta", "library_id", "library_snapshot_at",
                            "library_version_at_snapshot", "name", "category_id",
                            "instance",
                        )
                        if hasattr(module, k)
                    }
                snapshot = coerce_legacy_module(raw)
            except Exception as e:
                logger.warning(
                    "Failed to coerce module %r at index %s: %s", module, index, e
                )
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "type": module_type,
                    "enabled": True,
                    "status": "failed",
                    "writes": [],
                    "error": {"type": type(e).__name__, "message": str(e)},
                })
                continue

            try:
                bindings = resolve_module(snapshot, ctx)
            except UnknownModuleType:
                logger.warning(
                    "Unknown module type %r at index %s — skipped",
                    module_type,
                    index,
                )
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "type": module_type,
                    "enabled": True,
                    "status": "skipped_unknown_type",
                    "writes": [],
                    "error": None,
                })
                continue
            except Exception as e:
                logger.exception(
                    "Handler %r failed at index %s", module_type, index
                )
                ctx["__wp_warnings__"].append({
                    "type": "handler_error",
                    "severity": "error",
                    "module_id": _module_id,
                    "source_field": "payload",
                    "position": 0,
                    "token_index": None,
                    "detail": {
                        "exception_type": type(e).__name__,
                        "exception_message": str(e),
                        "traceback": None,
                    },
                    "message": (
                        f"Module {module_type} failed: {type(e).__name__}: {e}"
                    ),
                })
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "type": module_type,
                    "enabled": True,
                    "status": "failed",
                    "writes": [],
                    "error": {"type": type(e).__name__, "message": str(e)},
                })
                continue

            writes = []
            for var, value in (bindings or {}).items():
                key = var.lstrip("$")
                before = ctx.get(key)
                ctx[key] = value
                writes.append({
                    "variable": key,
                    "value": value,
                    "source": module_type,
                    "overwrite": before is not None and before != value,
                })

            ctx["__wp_trace__"].append({
                "id": _module_id,
                "type": module_type,
                "enabled": True,
                "status": "ok",
                "writes": writes,
                "error": None,
            })

        return ctx
