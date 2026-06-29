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

# `@{uuid}` ref matcher — mirror of engine.syntax.tokenize._REF_RE
# (4-segment: uuid + optional #name / :expr / !null; only the uuid is
# captured here). Used by the never_applied warning classifier to tell
# "target has a carrier/instance somewhere in the chain" apart from
# "target uuid is nowhere to be found".
_PIPELINE_REF_RE = re.compile(
    r"@\{([0-9a-f]{8})(?:#[^#:}@{!]*)?(?::[^}!]*)?(?:![^}]*)?\}"
)


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


# Characters that break the engine ref tokenizer's `#name` segment
# (`[^#:}@{]*`). Anything in this set gets replaced with a space when
# embedding a cached name into a `@{uuid#name}` ref so a stray apostrophe
# or curly brace can't shatter the warning's parse on the frontend.
_REF_NAME_FORBIDDEN = re.compile(r"[#:}@{]")


def _build_ref_name_suffix(name: Any) -> str:
    """Return the `#name` suffix for a cached ref token, or `""` when no
    usable name was provided. Used by the `constraint_never_applied`
    warning emitter so chips render a readable label even when the
    workflow is imported on a machine whose library lacks the referenced
    modules — the cached `#name` is the only fallback RefChip has in
    that scenario."""
    if not isinstance(name, str):
        return ""
    cleaned = _REF_NAME_FORBIDDEN.sub(" ", name).strip()
    return f"#{cleaned}" if cleaned else ""


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


def _module_seed_scope(module: object) -> str | None:
    """Read a module's base ``instance.seed_scope`` ("hold"/"vary"/None).
    Works for both dict and object module shapes. seed_scope is a base-only
    setting (disabled in per-frame edit mode), so the base instance is
    authoritative."""
    inst = module.get("instance") if isinstance(module, dict) else getattr(module, "instance", None)
    if isinstance(inst, dict):
        s = inst.get("seed_scope")
        return s if isinstance(s, str) else None
    return None


class PipelineEngine:
    """Runs an ordered list of modules against a context dict."""

    def run(
        self,
        modules: list[Module],
        ctx: Context | None = None,
        seed: int = 0,
        hold_seed: int | None = None,
        loop_index: int = 0,
    ) -> Context:
        """Execute modules top-to-bottom, mutating ctx, returning ctx."""
        ctx = {} if ctx is None else ctx
        ctx["__wp_node_seed__"] = seed
        ctx["__wp_node_seed_hold__"] = hold_seed if hold_seed is not None else seed
        ctx["__wp_loop_index__"] = loop_index
        ctx["__wp_rng__"] = random.Random(seed)
        ctx.setdefault("__wp_warnings__", [])
        ctx.setdefault("__wp_trace__", [])
        ctx.setdefault("__wp_internal_flags__", {})
        # SP3 reach selector: per-constraint firing count keyed by
        # `__constraint_module_id__`. Drives first/next/all/pick
        # coverage in apply_constraints_for_target + the never_applied /
        # partial_reach finalisation below. Replaces the pre-SP3
        # one-shot consumed-set.
        ctx.setdefault("__wp_constraint_hits__", {})

        # "Hold the value" base pass. A module on seed_scope=hold must resolve
        # to its frame-0 (loop_index=0) value on EVERY iteration — INCLUDING
        # nested @{} refs, which resolve_text bakes into the stored value.
        # Re-resolving each iteration (the old seed-swap) failed for
        # constrained wildcards (the constraint reshapes the pool per
        # iteration) and for nested refs. So when a loop is driving
        # (loop_index != 0) and any module holds, resolve the chain ONCE at
        # loop_index=0 with the constant hold seed; held handlers copy their
        # resolved value from this base context verbatim. The deepcopy keeps
        # the throwaway pass's warnings/trace/constraint-state off the real
        # ctx. loop_index=0 here means the recursive run skips its own base
        # pass — no infinite recursion.
        _any_hold = any(_module_seed_scope(m) == "hold" for m in modules)
        if loop_index != 0 and _any_hold:
            import copy as _copy

            _hb = int(ctx.get("__wp_node_seed_hold__", 0) or 0)
            base_ctx = PipelineEngine().run(
                modules,
                ctx=_copy.deepcopy(ctx),
                seed=_hb,
                hold_seed=_hb,
                loop_index=0,
            )
            ctx["__wp_hold_base_ctx__"] = base_ctx

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
                # Display name. Stashed alongside `id` / `_uid` so handlers
                # that emit user-facing warnings (notably the constraint
                # handler — see `__constraint_library_name__`) can embed
                # the name as a cached `#name` ref suffix. That suffix
                # survives library + embed-bundle misses (workflows
                # imported from someone else's machine), letting WP_Debug
                # render a readable chip instead of a raw uuid.
                _module_name = module.get("name", "") or ""
                # Per-insertion bundle discriminator. Two instances of one
                # library wildcard (a bundle inserted twice) carry DISTINCT
                # `bundle_origin` values (insert.ts stamps each child with
                # its immediate BundleInstance._uid). Threaded into ctx so a
                # constraint can bind to the source pick from its OWN bundle
                # copy (task_5200c1fc). Empty string when the module has no
                # bundle origin (top-level / manually-added / legacy).
                _module_bundle_origin = module.get("bundle_origin", "") or ""
            else:
                _module_id = getattr(module, "id", "")
                _module_uid = getattr(module, "_uid", "") or ""
                _module_type_raw = getattr(module, "type", None) or ""
                _module_enabled = getattr(module, "enabled", True)
                _module_name = getattr(module, "name", "") or ""
                _module_bundle_origin = getattr(module, "bundle_origin", "") or ""

            _k = int(ctx.get("__wp_loop_index__", 0))
            # Per-frame enable override. `frame_enabled[str(k)]` overrides the
            # base `enabled` flag for frame k in EITHER direction: a base-off
            # module can be turned ON for select frames, a base-on module OFF
            # for others. effective = frame_enabled.get(k, base_enabled).
            # Legacy `disabled_frames` (a one-way blocklist) is still honoured —
            # each listed frame reads as frame_enabled[k]=False.
            _frame_enabled_map = (
                module.get("frame_enabled")
                if isinstance(module, dict)
                else getattr(module, "frame_enabled", None)
            )
            _legacy_disabled = (
                module.get("disabled_frames")
                if isinstance(module, dict)
                else getattr(module, "disabled_frames", None)
            )
            _frame_override: bool | None = None
            if isinstance(_frame_enabled_map, dict) and str(_k) in _frame_enabled_map:
                _frame_override = bool(_frame_enabled_map[str(_k)])
            elif isinstance(_legacy_disabled, (list, tuple)) and _k in {
                int(f)
                for f in _legacy_disabled
                if isinstance(f, (int, float)) and not isinstance(f, bool)
            }:
                _frame_override = False
            _effective_enabled = (
                _frame_override if _frame_override is not None else bool(_module_enabled)
            )

            if not _effective_enabled:
                # Module is suppressed this frame. Distinguish a per-frame
                # disable (a frame override forced it off) from a global
                # disable (base off, no frame override) so the debug viewer
                # can label `skipped_frame` vs `skipped_disabled`. Either way
                # the trace row still surfaces what it WOULD have written so
                # the debug viewer can label `$varname (disabled)` rather than
                # falling back to an opaque short-uuid.
                _frame_forced_off = _frame_override is False
                meta = _extract_static_meta(module)
                ctx["__wp_trace__"].append({
                    "id": _module_id,
                    "_uid": _module_uid,
                    "type": _module_type_raw,
                    "enabled": bool(_module_enabled) if _frame_forced_off else False,
                    "status": "skipped_frame" if _frame_forced_off else "skipped_disabled",
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
                    # `iteration_overrides` is load-bearing — the per-frame
                    # override patch below reads it back off `raw`. `disabled_frames`
                    # is listed for snapshot honesty only (the skip gate already
                    # read it module-direct above).
                    raw = {
                        k: getattr(module, k)
                        for k in (
                            "id", "type", "enabled", "payload", "entries",
                            "meta", "library_id", "library_snapshot_at",
                            "library_version_at_snapshot", "name", "category_id",
                            "instance", "iteration_overrides",
                            "disabled_frames", "frame_enabled",
                        )
                        if hasattr(module, k)
                    }
                snapshot = coerce_legacy_module(raw)
                # Per-frame iteration override: patch snapshot["instance"]
                # for the current loop index BEFORE the handler runs.
                # iteration_overrides is a dict keyed by stringified index;
                # the matching partial dict is shallow-merged into instance.
                _ov = (
                    raw.get("iteration_overrides")
                    if isinstance(raw, dict)
                    else getattr(module, "iteration_overrides", None)
                )
                if isinstance(_ov, dict):
                    _frame_key = str(ctx.get("__wp_loop_index__", 0))
                    _patch = _ov.get(_frame_key)
                    if isinstance(_patch, dict) and isinstance(
                        snapshot.get("instance"), dict
                    ):
                        snapshot["instance"] = {**snapshot["instance"], **_patch}
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
            #     This is the BARE per-instance uid (no node prefix). The
            #     constraint handler keys its `__constraint_module_id__`
            #     (the SP3 per-constraint hit counter) on THIS so two
            #     instances of the same library constraint entry reach
            #     INDEPENDENTLY (per CLAUDE.md: "author multiple constraint
            #     modules" to affect multiple targets). It's ALSO the
            #     `firing_uid` a direct `pick` selector matches against —
            #     so a persisted `pick` must carry the bare `_uid`, not the
            #     UI's badge rowKey (`${nodeId}#${_uid}`). Falls back to the
            #     library id when `_uid` is absent (legacy / test modules).
            ctx["__wp_current_module_id__"] = _module_id
            ctx["__wp_current_module_uid__"] = _module_uid or _module_id
            ctx["__wp_current_module_name__"] = _module_name
            # See the `_module_bundle_origin` derivation above — exposed to
            # handlers (wildcard_handler records it on the pick; constraint_
            # handler captures it on the registered meta) so source-instance
            # binding can match a constraint to its own bundle copy's pick.
            ctx["__wp_current_module_bundle_origin__"] = _module_bundle_origin
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
        ctx.pop("__wp_current_module_name__", None)
        ctx.pop("__wp_current_module_bundle_origin__", None)

        # SP3 reach selector finalisation: emit `constraint_never_applied`
        # for every registered constraint whose selector covered ZERO
        # firing target instances (hit count 0). Surfaces in WP_Debug so
        # the user sees "you put a constraint here but nothing downstream
        # took it" — the chain still succeeds. The `partial_reach` pass
        # below covers constraints that DID fire but reached fewer
        # instances than a `next N` / `pick` selector asked for.
        #
        # Dedup by cid — sibling instances of the same library entry
        # share `__constraint_module_id__`, so they show up as two
        # entries in the bucket. Without the dedup the user sees the
        # same warning twice for the same logical constraint (2026-05-26).
        constraints_bucket = ctx.get("__wp_constraints__") or []
        hits = ctx.get("__wp_constraint_hits__") or {}
        catalog = ctx.get("__wp_catalog__")
        warned_cids: set[str] = set()
        if isinstance(constraints_bucket, list):
            for c in constraints_bucket:
                if not isinstance(c, dict):
                    continue
                cid = c.get("__constraint_module_id__")
                if not cid or hits.get(cid, 0) != 0:
                    continue
                if cid in warned_cids:
                    continue
                warned_cids.add(cid)
                # `cid` keys the dedup bookkeeping (per-instance `_uid` so
                # two canvas instances of the same library constraint are
                # independent). The message text, on the other hand, must
                # reference the LIBRARY id — that's the 8-hex uuid the
                # SPA/Debug chip resolver looks up in the module catalog
                # to render the constraint's name. Falling back to `cid`
                # only when the library id is missing (legacy / hand-built
                # constraints) keeps the warning informative either way.
                library_cid = c.get("__constraint_library_id__") or cid
                target_uuid = c.get("target_wildcard_id", "")
                # Build `#name` cache suffixes so the chip survives a
                # library-missing import. The SPA's chip resolver looks
                # the uuid up against the importer's local library — if
                # the workflow ships with modules the importer doesn't
                # have, the lookup misses and the chip falls back to
                # whatever cached name the ref token carries (per
                # RefChip.vue's unresolved-with-cached-name path). The
                # constraint's name was stashed by its handler; the
                # target's name is read from the per-run catalog. Sanitise
                # both against the engine's ref tokenizer (`[^#:}@{]*` is
                # the allowed name charset; anything else is replaced with
                # a space) so a name with stray punctuation can't break
                # the warning's parse.
                target_name = ""
                if isinstance(catalog, dict):
                    target_row = catalog.get(target_uuid)
                    if isinstance(target_row, dict):
                        target_name = target_row.get("name", "") or ""
                cid_suffix = _build_ref_name_suffix(c.get("__constraint_library_name__"))
                tgt_suffix = _build_ref_name_suffix(target_name)
                # Classify the cause so the message is actionable.
                # Reach is downstream-relative: a constraint only applies
                # to target occurrences that resolve AFTER it registers.
                # So a never-applied constraint whose target IS present in
                # the chain means every occurrence ran BEFORE this
                # constraint registered (ordering), or sits in a
                # branch/Context this run didn't reach. Absent target =
                # a wrong/stale uuid.
                present = _target_present_in_chain(
                    target_uuid, modules, catalog,
                )
                if present:
                    # Target IS in the chain but the selector covered no
                    # firing occurrence — every appearance resolved
                    # BEFORE this constraint registered (e.g. a source
                    # wildcard that nests its own @{target}), or lives in
                    # a branch / Context this run didn't execute, or is
                    # disabled. Deliberately NOT prescribing "move the
                    # constraint up" — that's wrong when the target's
                    # carrier is also the constraint's source (the source
                    # must stay upstream of the constraint).
                    message = (
                        f"constraint @{{{library_cid}{cid_suffix}}} did not apply — its target "
                        f"@{{{target_uuid}{tgt_suffix}}} is in the chain but every appearance "
                        f"resolved before this constraint registered, or is "
                        f"disabled / in a branch this run skipped."
                    )
                else:
                    message = (
                        f"constraint @{{{library_cid}{cid_suffix}}} did not apply — "
                        f"no @{{{target_uuid}{tgt_suffix}}} wildcard instance or "
                        f"nested-ref carrier found in this chain "
                        f"(check the constraint's target uuid)."
                    )
                warnings_bucket = ctx.setdefault("__wp_warnings__", [])
                if isinstance(warnings_bucket, list):
                    warnings_bucket.append({
                        "type": "constraint_never_applied",
                        # `warn` (not `info`): an authored constraint that
                        # silently never fires is almost always either a
                        # misconfiguration (wrong target uuid, missing
                        # source/target wildcard in the chain) or a
                        # disabled / dead branch the user forgot about.
                        # Either way it deserves the yellow advisory chip,
                        # not the blue informational one — the constraint
                        # is doing nothing, and the user should see it.
                        "severity": "warn",
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
                # Source-side companion warning. The `never_applied` message
                # above is target-focused; when the constraint's SOURCE
                # wildcard is ALSO absent from the chain, surface that
                # distinctly so the Debug viewer shows BOTH ends (mirrors the
                # editor's separate "source missing" / "target missing" row
                # badges). A constraint registers by its own module position,
                # so it can sit in the bucket with neither end present.
                source_uuid = c.get("source_wildcard_id", "")
                if source_uuid and not _target_present_in_chain(
                    source_uuid, modules, catalog,
                ):
                    src_row = (
                        catalog.get(source_uuid) if isinstance(catalog, dict) else None
                    )
                    source_name = (
                        (src_row.get("name", "") or "")
                        if isinstance(src_row, dict) else ""
                    )
                    src_suffix = _build_ref_name_suffix(source_name)
                    warnings_bucket = ctx.setdefault("__wp_warnings__", [])
                    if isinstance(warnings_bucket, list):
                        warnings_bucket.append({
                            "type": "constraint_source_missing",
                            "severity": "warn",
                            "module_id": cid,
                            "source_field": "",
                            "position": 0,
                            "token_index": None,
                            "detail": {
                                "constraint_id": cid,
                                "source_wildcard_id": source_uuid,
                            },
                            "message": (
                                f"constraint @{{{library_cid}{cid_suffix}}} did not apply — "
                                f"its source @{{{source_uuid}{src_suffix}}} wildcard isn't in "
                                f"this chain, so it never registers a source pick."
                            ),
                        })

        # SP3 partial-reach finalisation: a constraint that DID fire but
        # whose `next N` / `pick` selector matched FEWER occurrences than
        # requested. Distinct from never_applied (which fired zero times)
        # — this is "the selector asked for more than the chain offered
        # downstream". `all` / `first` can't be partial. Deduped by cid,
        # same as never_applied.
        partial_warned: set[str] = set()
        if isinstance(constraints_bucket, list):
            for c in constraints_bucket:
                if not isinstance(c, dict):
                    continue
                cid = c.get("__constraint_module_id__")
                seen = hits.get(cid, 0) if cid else 0
                if not cid or seen == 0 or cid in partial_warned:
                    continue
                sel = c.get("target_select") or {"mode": "all"}
                mode = sel.get("mode", "all")
                if mode == "next":
                    try:
                        want = int(sel.get("count", 1))
                    except (TypeError, ValueError):
                        want = 1
                elif mode == "pick":
                    want = len(sel.get("picks") or [])
                else:
                    continue
                # LIMITATION (holistic-review L1): `seen` is the per-cid
                # TOTAL target-encounter count (`hits[cid]`, bumped on
                # every firing in apply_constraints_for_target), NOT the
                # count of picks that actually MATCHED. So a `pick`
                # partial signal is imprecise: it compares encounters to
                # `len(picks)` rather than matched-vs-listed. A precise
                # count would need a separate ctx-threaded matched-pick
                # counter (new bookkeeping across the _constraints apply
                # boundary) — deferred to avoid over-plumbing. `next` is
                # exact (it covers the first N encounters by construction).
                if seen >= want:
                    continue
                partial_warned.add(cid)
                warnings_bucket = ctx.setdefault("__wp_warnings__", [])
                if isinstance(warnings_bucket, list):
                    warnings_bucket.append({
                        # Spec: partial reach is INFO, not warn — the
                        # selector simply found fewer downstream targets
                        # than requested this run (not an error condition).
                        # `constraint_never_applied` stays `warn` (a
                        # constraint that fired zero times is worth a louder
                        # signal). DebugViewer maps `info` → blue/accent.
                        "type": "constraint_partial_reach",
                        "severity": "info",
                        "module_id": cid,
                        "source_field": "",
                        "position": 0,
                        "token_index": None,
                        "detail": {
                            "constraint_id": cid,
                            "target_wildcard_id": c.get("target_wildcard_id"),
                            "requested": want,
                            "reached": seen,
                        },
                        "message": (
                            f"constraint reach selector ({mode}) asked for "
                            f"{want} target instance(s) but only {seen} "
                            f"resolved downstream this run."
                        ),
                    })

        return ctx
