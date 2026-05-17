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
from typing import Any

from engine.context import Context
from engine.modules import Module
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import coerce_legacy_module

logger = logging.getLogger(__name__)


def _extract_static_meta(
    module_raw: Any,
) -> dict[str, Any]:
    """Pull metadata fields out of a module dict/dataclass that the
    debug viewer surfaces independently of execution success.

    Returns a dict that may contain:
      - ``binding`` — the variable a single-binding module declares
        (``wildcard``/``combine``/``derivation``). Empty for
        ``constraint`` (no binding) and ``fixed_values`` (multi-binding
        — entries listed via ``writes`` after run instead).
      - ``bindings`` — list of variable names a multi-binding module
        declares (``fixed_values``). Used when the module is disabled
        / errors before writes get populated.
      - ``internal`` — bool, true when ``instance.internal`` is set;
        every binding the module would produce is engine-only.
      - ``seed_locked`` — bool, true when ``instance.locked_seed`` is
        a number; the module rolls with that seed not the chain seed.
      - ``constraint_source`` / ``constraint_target`` — the source +
        target wildcard uuids on a ``constraint`` payload, so the
        debug viewer can label the row as `$src → $tgt`.

    Robust to malformed shapes — every read is type-checked, every
    failure path returns an empty dict so the trace path doesn't
    crash on a bad workflow JSON.
    """
    if isinstance(module_raw, dict):
        m_type = module_raw.get("type", "") or ""
        inst = module_raw.get("instance", {})
        payload = module_raw.get("payload", {})
        entries = module_raw.get("entries", [])
    else:
        m_type = getattr(module_raw, "type", "") or ""
        inst = getattr(module_raw, "instance", {})
        payload = getattr(module_raw, "payload", {})
        entries = getattr(module_raw, "entries", [])

    inst = inst if isinstance(inst, dict) else {}
    payload = payload if isinstance(payload, dict) else {}

    locked_seed = inst.get("locked_seed")
    is_locked = isinstance(locked_seed, (int, float))
    meta: dict[str, Any] = {
        "internal": bool(inst.get("internal", False)),
        "seed_locked": is_locked,
    }
    # When the module declares a locked_seed, surface the value in the
    # trace row regardless of execution status. Pre-fix only ok-status
    # rows got `seed: effective_seed` set; disabled / errored rows had
    # no seed, so the user couldn't see what seed a locked-but-disabled
    # module would have used.
    if is_locked:
        meta["seed"] = int(locked_seed)

    if m_type == "fixed_values":
        # fixed_values declares its variables in `entries` (or
        # `payload.values` for the unified-list shape used by the SPA).
        # Either way, surface every variable name so the disabled
        # trace row can show *what* would have been written.
        seen: list[str] = []
        for source in (entries, payload.get("entries"), payload.get("values")):
            if not isinstance(source, list):
                continue
            for e in source:
                if isinstance(e, dict):
                    name = e.get("variable_name") or e.get("name")
                    if isinstance(name, str) and name and name not in seen:
                        seen.append(name)
        if seen:
            meta["bindings"] = seen
    elif m_type == "constraint":
        src = payload.get("source_wildcard_id")
        tgt = payload.get("target_wildcard_id")
        if isinstance(src, str) and src:
            meta["constraint_source"] = src
        if isinstance(tgt, str) and tgt:
            meta["constraint_target"] = tgt
    elif m_type == "combine":
        # Combine writes to `payload.output_var` (instance may override
        # via `variable_binding` for the picker-driven flow). Surface
        # the resolved name so disabled-combine rows in the debug
        # viewer show `$output_var (disabled)` instead of a uuid.
        b = (
            inst.get("variable_binding")
            or payload.get("output_var")
            or payload.get("var_binding")
            or ""
        )
        if isinstance(b, str):
            b = b.lstrip("$").strip()
            if b:
                meta["binding"] = b
    elif m_type == "derivation":
        # Derivation can write to MULTIPLE target_vars (one per branch
        # `action.target_var`, plus the `else.action.target_var`).
        # Collect every declared target so the disabled-derivation row
        # shows all of them in the debug viewer instead of a uuid.
        seen_targets: list[str] = []
        rules = payload.get("rules")
        if isinstance(rules, list):
            for rule in rules:
                if not isinstance(rule, dict):
                    continue
                for branch in rule.get("branches", []) or []:
                    if not isinstance(branch, dict):
                        continue
                    action = branch.get("action")
                    if isinstance(action, dict):
                        target = action.get("target_var")
                        if isinstance(target, str):
                            target = target.lstrip("$").strip()
                            if target and target not in seen_targets:
                                seen_targets.append(target)
                else_block = rule.get("else")
                if isinstance(else_block, dict):
                    action = else_block.get("action")
                    if isinstance(action, dict):
                        target = action.get("target_var")
                        if isinstance(target, str):
                            target = target.lstrip("$").strip()
                            if target and target not in seen_targets:
                                seen_targets.append(target)
        if seen_targets:
            meta["bindings"] = seen_targets
    else:
        # Wildcard / pipeline / other single-binding modules. Picker
        # writes `instance.variable_binding`; legacy snapshots may
        # carry `payload.var_binding` instead.
        b = inst.get("variable_binding") or payload.get("var_binding") or ""
        if isinstance(b, str) and b:
            meta["binding"] = b.lstrip("$").strip()

    return meta


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
                # Per-instance uid distinct from the library uuid `id`.
                # Siblings (same library entry instantiated twice) share
                # `id` but each has its own `_uid`; trace consumers that
                # need per-row state (lock-fallback, per-instance seed
                # display) key by `_uid`. Defaults to empty string when
                # the entry pre-dates the `_uid` migration.
                _module_uid = module.get("_uid", "") or ""
                _module_type_raw = module.get("type", None) or ""
                _module_enabled = module.get("enabled", True)
            else:
                _module_id = getattr(module, "id", "")
                _module_uid = getattr(module, "_uid", "") or ""
                _module_type_raw = getattr(module, "type", None) or ""
                _module_enabled = getattr(module, "enabled", True)

            if not _module_enabled:
                # Disabled modules don't run — but the trace row still
                # surfaces what the module would have written, so the
                # debug viewer can label it `$varname (disabled)`
                # instead of falling back to an opaque short-uuid.
                meta = _extract_static_meta(module)
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "_uid": _module_uid,
                    "type": _module_type_raw,
                    "enabled": False,
                    "status": "skipped_disabled",
                    "writes": [],
                    "error": None,
                    **meta,
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
                meta = _extract_static_meta(module)
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "_uid": _module_uid,
                    "type": module_type,
                    "enabled": True,
                    "status": "failed",
                    "writes": [],
                    "error": {"type": type(e).__name__, "message": str(e)},
                    **meta,
                })
                continue

            # Stash the active module's id in ctx so handlers that
            # need to identify themselves (constraint-aware wildcards
            # looking up `__wp_constraints__[*].target_wildcard_id`)
            # can read it without reaching into snapshot internals.
            # Cleared in the finally below so a stale id doesn't leak
            # into the next iteration's resolve call.
            ctx["__wp_current_module_id__"] = _module_id
            meta = _extract_static_meta(module)
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
                    "_uid": _module_uid,
                    "type": module_type,
                    "enabled": True,
                    "status": "skipped_unknown_type",
                    "writes": [],
                    "error": None,
                    **meta,
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
                    "_uid": _module_uid,
                    "type": module_type,
                    "enabled": True,
                    "status": "failed",
                    "writes": [],
                    "error": {"type": type(e).__name__, "message": str(e)},
                    **meta,
                })
                continue

            writes = []
            # `instance.internal == True` marks every binding the
            # module produces as engine-only — they stay in ctx so
            # downstream modules can read them, but `strip_internals`
            # drops them on the way out so they don't surface on the
            # public PIPELINE_CONTEXT socket. Useful for "scratch"
            # vars that drive a derivation/combine but shouldn't
            # become prompt-text noise.
            inst = snapshot.get("instance", {}) if isinstance(snapshot, dict) else {}
            mark_internal = bool(inst.get("internal", False)) if isinstance(inst, dict) else False
            for var, value in (bindings or {}).items():
                key = var.lstrip("$")
                before = ctx.get(key)
                ctx[key] = value
                if mark_internal:
                    flags = ctx.setdefault("__wp_internal_flags__", {})
                    flags[key] = True
                writes.append({
                    "variable": key,
                    "value": value,
                    "source": module_type,
                    "overwrite": before is not None and before != value,
                })

            # `seed` on the trace entry: the effective seed THIS
            # module rolled with — `instance.locked_seed` if locked,
            # else the chain seed. Surfaces to the frontend via the
            # WP_Context node's UI payload so the lock-toggle defaults
            # can grab the AUTHORITATIVE value (not the local widget,
            # which lies when the seed input is link-driven).
            locked = inst.get("locked_seed") if isinstance(inst, dict) else None
            if isinstance(locked, (int, float)):
                effective_seed = int(locked)
            else:
                effective_seed = int(ctx.get("__wp_node_seed__", 0) or 0)
            ctx["__wp_trace__"].append({
                "id": _module_id,
                "_uid": _module_uid,
                "type": module_type,
                "enabled": True,
                "status": "ok",
                "writes": writes,
                "error": None,
                "seed": effective_seed,
                **meta,
            })

        # Drop the active-module marker so it doesn't leak into the
        # public socket payload (it's an `__`-prefixed key, so
        # `strip_internals` would already filter it, but clearing it
        # is cheap and keeps post-run ctx introspection tidy).
        ctx.pop("__wp_current_module_id__", None)
        return ctx
