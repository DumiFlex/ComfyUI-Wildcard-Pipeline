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
import re
from typing import Any

from engine.context import Context
from engine.modules import Module
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import coerce_legacy_module

logger = logging.getLogger(__name__)

# `@{uuid}` ref matcher — mirror of engine.syntax.tokenize._REF_RE.
# Used by the never_applied warning classifier to tell "target has a
# carrier/instance somewhere in the chain" apart from "target uuid is
# nowhere to be found".
_PIPELINE_REF_RE = re.compile(r"@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}")


def _module_field(module: Any, key: str) -> Any:
    """Read a field from a module that may be a dict or an object."""
    if isinstance(module, dict):
        return module.get(key)
    return getattr(module, key, None)


def _target_present_in_chain(
    target_uuid: str,
    modules: list[Any],
    catalog: dict[str, Any] | None,
) -> bool:
    """True when `target_uuid` has SOME representation in the chain —
    either a direct wildcard instance (a module whose id == target) or a
    carrier (any wildcard, in the module list OR the catalog, with an
    `@{target}` ref in one of its option values).

    Used purely to pick the right never_applied warning wording: if the
    target is present-but-unclaimed the cause is ordering / a skipped
    roll; if it's absent the cause is a wrong uuid. Best-effort + cheap
    (library volumes are dozens of modules, single-digit refs each)."""
    def _options_of(payload: Any) -> list:
        if isinstance(payload, dict):
            opts = payload.get("options")
            return opts if isinstance(opts, list) else []
        return []

    def _carries(payload: Any) -> bool:
        for opt in _options_of(payload):
            val = opt.get("value") if isinstance(opt, dict) else None
            if isinstance(val, str) and any(
                m.group(1) == target_uuid for m in _PIPELINE_REF_RE.finditer(val)
            ):
                return True
        return False

    for m in modules:
        if _module_field(m, "type") != "wildcard":
            continue
        if _module_field(m, "id") == target_uuid:
            return True
        if _carries(_module_field(m, "payload")):
            return True
    if isinstance(catalog, dict):
        for entry in catalog.values():
            payload = entry.get("payload") if isinstance(entry, dict) else None
            if _carries(payload):
                return True
    return False


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
        # Tracks constraint module ids that have already fired against
        # their first downstream target instance. See
        # docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md.
        ctx.setdefault("__wp_consumed_constraints__", set())

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
            #
            # Two distinct identifiers:
            #   - `__wp_current_module_id__`  = library uuid (`id`). The
            #     wildcard handler matches THIS against a constraint's
            #     `target_wildcard_id` (which is a library uuid).
            #   - `__wp_current_module_uid__` = per-instance uid (`_uid`).
            #     The constraint handler keys its consumed-set entry on
            #     THIS so two instances of the same library constraint
            #     entry are independent one-shots (per CLAUDE.md: "author
            #     multiple constraint modules" to affect multiple
            #     targets). Falls back to the library id when `_uid` is
            #     absent (legacy / hand-built test modules).
            ctx["__wp_current_module_id__"] = _module_id
            ctx["__wp_current_module_uid__"] = _module_uid or _module_id
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

        # Drop the active-module markers so they don't leak into the
        # public socket payload (both are `__`-prefixed so
        # `strip_internals` would filter them, but clearing is cheap and
        # keeps post-run ctx introspection tidy).
        ctx.pop("__wp_current_module_id__", None)
        ctx.pop("__wp_current_module_uid__", None)

        # First-instance one-shot semantic: emit a soft (info) warning
        # for every registered constraint whose target instance never
        # came up during the chain. Surfaces in WP_Debug so the user
        # sees "you put a constraint here but nothing downstream took
        # it" — the chain still succeeds.
        # See docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md.
        #
        # Dedup by cid — sibling instances of the same library entry
        # share `__constraint_module_id__`, so they show up as two
        # entries in the bucket. Without the dedup the user sees the
        # same warning twice for the same logical constraint (2026-05-26).
        constraints_bucket = ctx.get("__wp_constraints__") or []
        consumed_set = ctx.get("__wp_consumed_constraints__") or set()
        catalog = ctx.get("__wp_catalog__")
        warned_cids: set[str] = set()
        if isinstance(constraints_bucket, list):
            for c in constraints_bucket:
                if not isinstance(c, dict):
                    continue
                cid = c.get("__constraint_module_id__")
                if not cid or cid in consumed_set:
                    continue
                if cid in warned_cids:
                    continue
                warned_cids.add(cid)
                target_uuid = c.get("target_wildcard_id", "")
                # Classify the cause so the message is actionable.
                # With the carrier-claim failsafe in place, a carrier
                # that rolls ANY option claims its constraint — so an
                # unconsumed constraint whose target IS present in the
                # chain means the target instance/carrier ran BEFORE
                # this constraint registered (ordering), or sits in a
                # branch/Context this run didn't reach. Absent target =
                # a wrong/stale uuid.
                present = _target_present_in_chain(
                    target_uuid, modules, catalog,
                )
                if present:
                    # Target IS in the chain. With the carrier-claim
                    # failsafe, any carrier/instance that ROLLS after the
                    # constraint registers claims it — so reaching this
                    # branch means the target's only appearance(s) ran
                    # BEFORE this constraint registered (e.g. a source
                    # wildcard that nests its own @{target}), or live in
                    # a branch / Context this run didn't execute, or are
                    # disabled. Deliberately NOT prescribing "move the
                    # constraint up" — that's wrong when the target's
                    # carrier is also the constraint's source (the source
                    # must stay upstream of the constraint).
                    message = (
                        f"constraint @{{{cid}}} did not apply — its target "
                        f"@{{{target_uuid}}} is in the chain but every appearance "
                        f"resolved before this constraint registered, or is "
                        f"disabled / in a branch this run skipped."
                    )
                else:
                    message = (
                        f"constraint @{{{cid}}} did not apply — no @{{{target_uuid}}} "
                        f"wildcard instance or nested-ref carrier found in this "
                        f"chain (check the constraint's target uuid)."
                    )
                warnings_bucket = ctx.setdefault("__wp_warnings__", [])
                if isinstance(warnings_bucket, list):
                    warnings_bucket.append({
                        "type": "constraint_never_applied",
                        "severity": "info",
                        "module_id": cid,
                        "source_field": "",
                        "position": 0,
                        "token_index": None,
                        "detail": {
                            "constraint_id": cid,
                            "target_wildcard_id": target_uuid,
                            "source_wildcard_id": c.get("source_wildcard_id", ""),
                            # `target_present` lets the DebugViewer pick a
                            # distinct icon/severity later without re-parsing
                            # the message string.
                            "target_present": present,
                        },
                        # Ids wrapped as `@{uuid}` so the DebugViewer's
                        # RichTextPreview resolves them to display names
                        # via the library cache (raw short-uuids would
                        # otherwise render as plain text).
                        "message": message,
                    })

        return ctx
