"""PipelineEngine — runs ordered modules through engine/modules/dispatcher.

Manages per-run state (rng, warnings, trace) and delegates per-module
resolution to dispatcher.resolve_module. Pre-Phase-5 the pipeline routed
fixed_values directly; Phase 5 routes everything via dispatcher and threads
ctx.rng for deterministic randomness.

The end-of-run constraint warnings live in ``engine/pipeline_warnings.py``.
"""
from __future__ import annotations

import copy
import dataclasses
import logging
import random
from collections.abc import Sequence
from typing import Any, TypeAlias

from engine import negatives, prefs
from engine.context import Context
from engine.modules import Module
from engine.modules._detail import DETAIL_KEY, EXPLAIN_KEY
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import coerce_legacy_module
from engine.pipeline_warnings import (  # noqa: F401  (re-exported)
    _PIPELINE_REF_RE,
    _REF_NAME_FORBIDDEN,
    _build_ref_name_suffix,
    _module_field,
    _target_direct_in_chain,
    _target_present_in_chain,
    finalize_constraint_warnings,
)
from engine.sweep import apply_pin_override

#: What a run takes: module dicts as the library stores them, or the legacy
#: dataclass modules (`coerce_legacy_module` turns them into dicts).
ModuleLike: TypeAlias = Module | dict[str, Any]

logger = logging.getLogger(__name__)

#: ctx key a caller sets to the ctx this run would have started from on loop
#: frame 0. The hold base pass runs on it (see ``PipelineEngine.run``).
FRAME0_CTX_KEY = "__wp_frame0_ctx__"

#: Per-module markers set while a module resolves, dropped after the run.
_ACTIVE_MODULE_KEYS = (
    "__wp_current_module_id__",
    "__wp_current_module_uid__",
    "__wp_instance_key__",
    "__wp_current_module_name__",
    "__wp_current_module_bundle_origin__",
    DETAIL_KEY,
)

#: Snapshot keys read off a generic (non-dict, non-dataclass) module object.
#: `iteration_overrides` is load-bearing — the per-frame override patch reads
#: it back off `raw`. `disabled_frames` is listed for snapshot honesty only
#: (the skip gate already read it module-direct).
_OBJECT_SNAPSHOT_KEYS = (
    "id", "type", "enabled", "payload", "entries",
    "meta", "library_id", "library_snapshot_at",
    "library_version_at_snapshot", "name", "category_id",
    "instance", "iteration_overrides",
    "disabled_frames", "frame_enabled",
)


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
        # Derivation can write to MULTIPLE target_vars (every action of
        # every branch, plus the else clause's; a clause runs `action` then
        # its `extra_actions`). Collect every declared target so the
        # disabled-derivation row shows all of them in the debug viewer
        # instead of a uuid.
        seen_targets: list[str] = []
        rules = payload.get("rules")
        if isinstance(rules, list):
            for rule in rules:
                if not isinstance(rule, dict):
                    continue
                clauses = [
                    b for b in rule.get("branches", []) or []
                    if isinstance(b, dict)
                ]
                if isinstance(rule.get("else"), dict):
                    clauses.append(rule["else"])
                for clause in clauses:
                    extra = clause.get("extra_actions")
                    actions = [clause.get("action")] + (
                        extra if isinstance(extra, list) else []
                    )
                    for action in actions:
                        if not isinstance(action, dict):
                            continue
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


def _module_binding(module: object) -> str | None:
    """Read the variable name a wildcard binds to, instance override first.

    Mirrors the precedence in `WildcardHandler.resolve`. Needed because rolled
    axes are keyed by BINDING — the namespace `$outfit.SHOES` addresses — while
    picks are keyed by module id, so the two carry-forwards cannot share a key.
    """
    inst = (
        module.get("instance") if isinstance(module, dict)
        else getattr(module, "instance", None)
    )
    if isinstance(inst, dict):
        b = inst.get("variable_binding")
        if isinstance(b, str) and b:
            return b
    payload = (
        module.get("payload") if isinstance(module, dict)
        else getattr(module, "payload", None)
    )
    if isinstance(payload, dict):
        b = payload.get("var_binding")
        if isinstance(b, str) and b:
            return b
    return None


def _display_name(module: object, fallback: str) -> str:
    """The name a user knows a module by: the stack row's `name`, else its
    library `meta.name`."""
    meta = module.get("meta") if isinstance(module, dict) else getattr(module, "meta", None)
    if isinstance(meta, dict):
        name = meta.get("name")
        if isinstance(name, str) and name:
            return fallback or name
    return fallback


def _finish_module(
    ctx: dict[str, Any],
    warn_mark: int,
    module_id: str,
    module_uid: str,
    name: str,
) -> dict[str, Any]:
    """Explain-mode extras for one module's trace row.

    Stamps every warning the module raised with its owner (resolver warnings
    such as `unknown_ref` carry no module id of their own) and returns the
    fields the trace row gains: the display name and whatever the handler put
    in its detail sink. Only called when the run asked to explain itself.
    """
    warnings = ctx.get("__wp_warnings__")
    if isinstance(warnings, list):
        for w in warnings[warn_mark:]:
            if isinstance(w, dict) and not w.get("owner_uid"):
                w["owner_id"] = module_id
                w["owner_uid"] = module_uid or module_id
    extras: dict[str, Any] = {}
    if name:
        extras["name"] = name
    detail = ctx.pop(DETAIL_KEY, None)
    if isinstance(detail, dict) and detail:
        extras["detail"] = detail
    return extras



@dataclasses.dataclass
class _ModuleHeader:
    """The id/type/enabled/... fields of one module row, read the same way
    for dict and object modules."""

    id: str
    # Per-instance uid distinct from the library uuid `id`. Siblings (same
    # library entry instantiated twice) share `id` but each has its own
    # `_uid`; trace consumers that need per-row state (lock-fallback,
    # per-instance seed display) key by `_uid`. Empty string when the entry
    # pre-dates the `_uid` migration.
    uid: str
    type: str
    enabled: Any
    # Display name. Stashed alongside `id` / `_uid` so handlers that emit
    # user-facing warnings (notably the constraint handler — see
    # `__constraint_library_name__`) can embed the name as a cached `#name`
    # ref suffix. That suffix survives library + embed-bundle misses
    # (workflows imported from someone else's machine), letting WP_Debug
    # render a readable chip instead of a raw uuid.
    name: str
    # Per-insertion bundle discriminator. Two instances of one library
    # wildcard (a bundle inserted twice) carry DISTINCT `bundle_origin`
    # values (insert.ts stamps each child with its immediate
    # BundleInstance._uid). Threaded into ctx so a constraint can bind to the
    # source pick from its OWN bundle copy (task_5200c1fc). Empty string when
    # the module has no bundle origin (top-level / manually-added / legacy).
    bundle_origin: str


def _read_header(module: Any) -> _ModuleHeader:
    if isinstance(module, dict):
        return _ModuleHeader(
            id=module.get("id", ""),
            uid=module.get("_uid", "") or "",
            type=module.get("type", None) or "",
            enabled=module.get("enabled", True),
            name=module.get("name", "") or "",
            bundle_origin=module.get("bundle_origin", "") or "",
        )
    return _ModuleHeader(
        id=getattr(module, "id", ""),
        uid=getattr(module, "_uid", "") or "",
        type=getattr(module, "type", None) or "",
        enabled=getattr(module, "enabled", True),
        name=getattr(module, "name", "") or "",
        bundle_origin=getattr(module, "bundle_origin", "") or "",
    )


def _frame_override(module: Any, frame: int) -> bool | None:
    """Per-frame enable override for `frame`, or None when there is none.

    `frame_enabled[str(k)]` overrides the base `enabled` flag for frame k in
    EITHER direction: a base-off module can be turned ON for select frames, a
    base-on module OFF for others. effective = frame_enabled.get(k,
    base_enabled). Legacy `disabled_frames` (a one-way blocklist) is still
    honoured — each listed frame reads as frame_enabled[k]=False."""
    frame_enabled_map = (
        module.get("frame_enabled")
        if isinstance(module, dict)
        else getattr(module, "frame_enabled", None)
    )
    legacy_disabled = (
        module.get("disabled_frames")
        if isinstance(module, dict)
        else getattr(module, "disabled_frames", None)
    )
    if isinstance(frame_enabled_map, dict) and str(frame) in frame_enabled_map:
        return bool(frame_enabled_map[str(frame)])
    if isinstance(legacy_disabled, (list, tuple)) and frame in {
        int(f)
        for f in legacy_disabled
        if isinstance(f, (int, float)) and not isinstance(f, bool)
    }:
        return False
    return None


def _coerce_snapshot(module: Any, module_uid: str, ctx: dict[str, Any]) -> Any:
    """The module as a snapshot dict, with this frame's iteration override
    and sweep pin applied. Raises whatever coercion raises."""
    # coerce_legacy_module expects a dict; convert dataclasses or duck-typed
    # objects by reading known attrs via getattr.
    if dataclasses.is_dataclass(module) and not isinstance(module, type):
        raw = dataclasses.asdict(module)  # type: ignore[arg-type]
    elif isinstance(module, dict):
        raw = module
    else:
        # Generic object: pull known snapshot keys via getattr so
        # class-level attributes (common in tests) are visible.
        raw = {
            k: getattr(module, k)
            for k in _OBJECT_SNAPSHOT_KEYS
            if hasattr(module, k)
        }
    snapshot = coerce_legacy_module(raw)
    # Per-frame iteration override: patch snapshot["instance"] for the
    # current loop index BEFORE the handler runs. iteration_overrides is a
    # dict keyed by stringified index; the matching partial dict is
    # shallow-merged into instance.
    ov = (
        raw.get("iteration_overrides")
        if isinstance(raw, dict)
        else getattr(module, "iteration_overrides", None)
    )
    if isinstance(ov, dict):
        frame_key = str(ctx.get("__wp_loop_index__", 0))
        patch = ov.get(frame_key)
        if isinstance(patch, dict) and isinstance(snapshot.get("instance"), dict):
            snapshot["instance"] = {**snapshot["instance"], **patch}
    # Sweep mode (WP_ContextLoop): pin a swept wildcard to this frame's
    # combination. Applied after the per-frame override so the sweep decides
    # which option fires.
    if isinstance(snapshot, dict):
        snapshot = apply_pin_override(snapshot, module_uid, ctx)
    return snapshot


def _set_active_module(ctx: dict[str, Any], h: _ModuleHeader) -> None:
    """Stash the active module's identity in ctx for its handler.

    Handlers that need to identify themselves (constraint-aware wildcards
    looking up `__wp_constraints__[*].target_wildcard_id`) read these
    without reaching into snapshot internals. Dropped after the run
    (`_clear_active_module`).

    Two distinct identifiers:
      - `__wp_current_module_id__`  = library uuid (`id`). The wildcard
        handler matches THIS against a constraint's `target_wildcard_id`
        (which is a library uuid).
      - `__wp_current_module_uid__` = per-instance uid (`_uid`). This is the
        BARE per-instance uid (no node prefix). The constraint handler keys
        its `__constraint_module_id__` (the SP3 per-constraint hit counter)
        on THIS so two instances of the same library constraint entry reach
        INDEPENDENTLY (per CLAUDE.md: "author multiple constraint modules" to
        affect multiple targets). It's ALSO the `firing_uid` a direct `pick`
        selector matches against — so a persisted `pick` must carry the bare
        `_uid`, not the UI's badge rowKey (`${nodeId}#${_uid}`). Falls back
        to the library id when `_uid` is absent (legacy / test modules).
    """
    ctx["__wp_current_module_id__"] = h.id
    ctx["__wp_current_module_uid__"] = h.uid or h.id
    # Random-stream key of this instance (engine/modules/_seed.py): its
    # bundle copy plus its own uid, so two instances (or two copies of one
    # bundle) never roll in lockstep.
    ctx["__wp_instance_key__"] = f"{h.bundle_origin}/{h.uid or h.id}"
    ctx["__wp_current_module_name__"] = h.name
    # Exposed to handlers (wildcard_handler records it on the pick;
    # constraint_handler captures it on the registered meta) so
    # source-instance binding can match a constraint to its own bundle
    # copy's pick.
    ctx["__wp_current_module_bundle_origin__"] = h.bundle_origin


def _clear_active_module(ctx: dict[str, Any]) -> None:
    """Drop the active-module markers so they don't leak into the public
    socket payload (all are `__`-prefixed so `strip_internals` would filter
    them, but clearing is cheap and keeps post-run ctx introspection
    tidy)."""
    for key in _ACTIVE_MODULE_KEYS:
        ctx.pop(key, None)


def _apply_bindings(
    ctx: dict[str, Any],
    bindings: dict[str, Any] | None,
    module_type: str,
    mark_internal: bool,
) -> list[dict[str, Any]]:
    """Write a handler's bindings into ctx and return the trace `writes`."""
    writes = []
    for var, value in (bindings or {}).items():
        key = var.lstrip("$")
        before = ctx.get(key)
        ctx[key] = value
        # Last-write-wins applies to the internal flag too: whichever module
        # writes the var LAST decides whether it is internal. A public writer
        # overriding an earlier internal one MUST clear the flag — otherwise
        # the var stays hidden from the assembler forever, even though its
        # final value came from a public module. (Mark $outfit internal, then
        # override it with a public $outfit: the override should be visible.)
        flags = ctx.setdefault("__wp_internal_flags__", {})
        if mark_internal:
            flags[key] = True
        else:
            flags.pop(key, None)
        writes.append({
            "variable": key,
            "value": value,
            "source": module_type,
            "overwrite": before is not None and before != value,
        })
    # A write replaces the value, so it replaces what the value carried:
    # bindings the handler gave no negatives lose theirs.
    negatives.settle_writes(ctx, [v.lstrip("$") for v in (bindings or {})])
    # WP Debug's trace shows what each write now carries.
    for w in writes:
        texts = [
            str(e.get("text", ""))
            for e in negatives.get_entries(ctx, w["variable"])
        ]
        if texts:
            w["negative"] = ", ".join(texts)
    return writes


def _handler_error_warning(
    module_id: str, module_type: str, e: Exception,
) -> dict[str, Any]:
    return {
        "type": "handler_error",
        "severity": "error",
        "module_id": module_id,
        "source_field": "payload",
        "position": 0,
        "token_index": None,
        "detail": {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": None,
        },
        "message": f"Module {module_type} failed: {type(e).__name__}: {e}",
    }


_NO_SEED = object()


class PipelineEngine:
    """Runs an ordered list of modules against a context dict."""

    def run(
        self,
        modules: Sequence[ModuleLike],
        ctx: Context | None = None,
        seed: int = 0,
        hold_seed: int | None = None,
        loop_index: int = 0,
    ) -> Context:
        """Execute modules top-to-bottom, mutating ctx, returning ctx."""
        ctx = {} if ctx is None else ctx
        self._init_run_state(ctx, seed, hold_seed, loop_index)
        # Canvas runs ask for per-module detail (derivation branch results,
        # pick odds, ...) for the WP Debug node; see engine/modules/_detail.py.
        explain = bool(ctx.get(EXPLAIN_KEY))
        self._hold_base_pass(modules, ctx, loop_index)
        for index, module in enumerate(modules):
            self._run_module(index, module, ctx, explain)
        _clear_active_module(ctx)
        finalize_constraint_warnings(ctx, modules)
        return ctx

    # ── run setup ─────────────────────────────────────────────────────────

    @staticmethod
    def _init_run_state(
        ctx: Context, seed: int, hold_seed: int | None, loop_index: int,
    ) -> None:
        """Seed the per-run engine keys (rng, warnings, trace, ...)."""
        ctx["__wp_node_seed__"] = seed
        ctx["__wp_node_seed_hold__"] = hold_seed if hold_seed is not None else seed
        ctx["__wp_loop_index__"] = loop_index
        ctx["__wp_rng__"] = random.Random(seed)
        ctx.setdefault("__wp_warnings__", [])
        ctx.setdefault("__wp_trace__", [])
        ctx.setdefault("__wp_internal_flags__", {})
        # Send-to-negative: per-variable negatives (engine/negatives.py).
        ctx.setdefault(negatives.NEG_KEY, {})
        # `@{uuid}` nesting limit from Settings (engine/prefs.py). setdefault
        # so a caller (or a test) that pinned a limit keeps it; set here
        # rather than per surface so canvas runs, preview and the Test Runner
        # all honor the same value. `__`-prefixed, so it never crosses a
        # socket — each node re-reads it at its own run.
        ctx.setdefault("__wp_max_ref_depth__", prefs.max_ref_depth())
        # SP3 reach selector: per-constraint firing count keyed by
        # `__constraint_module_id__`. Drives first/next/all/pick coverage in
        # apply_constraints_for_target + the never_applied / partial_reach
        # finalisation (engine/pipeline_warnings.py). Replaces the pre-SP3
        # one-shot consumed-set.
        ctx.setdefault("__wp_constraint_hits__", {})

    # ── hold-the-value base pass ──────────────────────────────────────────

    def _hold_base_pass(
        self, modules: Sequence[ModuleLike], ctx: Context, loop_index: int,
    ) -> None:
        """"Hold the value" base pass.

        A module on seed_scope=hold must resolve to its frame-0
        (loop_index=0) value on EVERY iteration — INCLUDING nested @{} refs,
        which resolve_text bakes into the stored value. Re-resolving each
        iteration (the old seed-swap) failed for constrained wildcards (the
        constraint reshapes the pool per iteration) and for nested refs. So
        when a loop is driving (loop_index != 0) and any module holds,
        resolve the chain ONCE at loop_index=0 with the constant hold seed;
        held handlers copy their resolved value from this base context
        verbatim. The deepcopy keeps the throwaway pass's
        warnings/trace/constraint-state off the real ctx. loop_index=0 here
        means the recursive run skips its own base pass — no infinite
        recursion.

        The base pass runs on frame 0's INPUTS when the caller has them
        (``FRAME0_CTX_KEY``: the ctx this node would have started from on
        frame 0, e.g. $iteration = 1 and frame 0's upstream picks), so a held
        wildcard whose constraint source follows $iteration stays on its
        frame-0 option. Given those, the pass runs even with no hold here, so
        the caller can hand frame 0's output downstream. Without them it
        falls back to this frame's inputs (the old behaviour).
        """
        frame0_input = ctx.pop(FRAME0_CTX_KEY, None)
        any_hold = any(_module_seed_scope(m) == "hold" for m in modules)
        if loop_index == 0 or not (any_hold or isinstance(frame0_input, dict)):
            return
        hb = int(ctx.get("__wp_node_seed_hold__", 0) or 0)
        base_ctx = PipelineEngine().run(
            modules,
            ctx=copy.deepcopy(
                frame0_input if isinstance(frame0_input, dict) else ctx
            ),
            seed=hb,
            hold_seed=hb,
            loop_index=0,
        )
        ctx["__wp_hold_base_ctx__"] = base_ctx
        self._carry_held_state(modules, ctx, base_ctx)

    @staticmethod
    def _carry_held_state(
        modules: Sequence[ModuleLike], ctx: Context, base_ctx: Context,
    ) -> None:
        """Carry the base pass's pick, axis and hit state for held modules.

        Held wildcards copy their frozen VALUE from the base pass but
        early-return before `_record_pick` (wildcard_handler), so their
        frame-0 pick never lands in the real ctx. Downstream constraints then
        can't find the held source — they mis-fire (spurious source_missing /
        never_applied warnings) and, cross-node, leave a held target
        UNCONSTRAINED (the held-outfit drift: kimono at frame 0,
        unconstrained pick on frames 2+). Carry the base pass's pick + hit
        state for held modules into the real ctx HERE, before the per-module
        loop, so the registration is present for this node's constraints AND
        flows downstream (via __wp_picks__ / __wp_constraints__ carry-over)
        into the next node's base pass. The value-freeze path in the wildcard
        handler is untouched.
        """
        held = [m for m in modules if _module_seed_scope(m) == "hold"]
        base_picks = base_ctx.get("__wp_picks__")
        if isinstance(base_picks, dict):
            real_picks = ctx.setdefault("__wp_picks__", {})
            if isinstance(real_picks, dict):
                for m in held:
                    mid = (
                        m.get("id", "") if isinstance(m, dict)
                        else getattr(m, "id", "")
                    )
                    if mid and mid in base_picks and mid not in real_picks:
                        real_picks[mid] = base_picks[mid]
        # Same carry-forward for rolled axes, but keyed by BINDING rather
        # than module id — that is the namespace `$outfit.SHOES` addresses.
        # Restricted to held modules, and `not in` rather than assignment, so
        # a wildcard that never asked to hold still re-rolls this iteration.
        # The declared-axes table travels with the rolls it describes.
        for table in ("__wp_axes__", "__wp_axis_decl__"):
            base_axes = base_ctx.get(table)
            if not isinstance(base_axes, dict):
                continue
            real_axes = ctx.setdefault(table, {})
            if not isinstance(real_axes, dict):
                continue
            for m in held:
                binding = _module_binding(m)
                if binding and binding in base_axes and binding not in real_axes:
                    real_axes[binding] = base_axes[binding]
        base_hits = base_ctx.get("__wp_constraint_hits__")
        if isinstance(base_hits, dict):
            real_hits = ctx.setdefault("__wp_constraint_hits__", {})
            if isinstance(real_hits, dict):
                for cid, n in base_hits.items():
                    real_hits[cid] = max(int(real_hits.get(cid, 0) or 0), int(n or 0))

    # ── one module ────────────────────────────────────────────────────────

    def _run_module(
        self, index: int, module: ModuleLike, ctx: Context, explain: bool,
    ) -> None:
        """Gate, coerce, dispatch and trace one module."""
        h = _read_header(module)
        warn_mark = len(ctx["__wp_warnings__"])
        if explain:
            h.name = _display_name(module, h.name)
            ctx[DETAIL_KEY] = {}

        frame_override = _frame_override(module, int(ctx.get("__wp_loop_index__", 0)))
        effective = (
            frame_override if frame_override is not None else bool(h.enabled)
        )
        if not effective:
            # Module is suppressed this frame. Distinguish a per-frame disable
            # (a frame override forced it off) from a global disable (base
            # off, no frame override) so the debug viewer can label
            # `skipped_frame` vs `skipped_disabled`. Either way the trace row
            # still surfaces what it WOULD have written so the debug viewer
            # can label `$varname (disabled)` rather than falling back to an
            # opaque short-uuid.
            forced_off = frame_override is False
            self._trace(
                ctx, h, module, warn_mark, explain,
                enabled=bool(h.enabled) if forced_off else False,
                status="skipped_frame" if forced_off else "skipped_disabled",
            )
            return

        try:
            snapshot = _coerce_snapshot(module, h.uid, ctx)
        except Exception as e:
            logger.warning(
                "Failed to coerce module %r at index %s: %s", module, index, e
            )
            self._trace(
                ctx, h, module, warn_mark, explain,
                status="failed",
                error={"type": type(e).__name__, "message": str(e)},
            )
            return

        _set_active_module(ctx, h)
        meta = _extract_static_meta(module)
        ctx.pop(negatives.TOUCHED_KEY, None)
        try:
            bindings = resolve_module(snapshot, ctx)
        except UnknownModuleType:
            logger.warning(
                "Unknown module type %r at index %s — skipped", h.type, index,
            )
            self._trace(
                ctx, h, module, warn_mark, explain,
                status="skipped_unknown_type", meta=meta,
            )
            return
        except Exception as e:
            logger.exception("Handler %r failed at index %s", h.type, index)
            ctx["__wp_warnings__"].append(_handler_error_warning(h.id, h.type, e))
            self._trace(
                ctx, h, module, warn_mark, explain,
                status="failed",
                error={"type": type(e).__name__, "message": str(e)},
                meta=meta,
            )
            return

        # `instance.internal == True` marks every binding the module produces
        # as engine-only — they stay in ctx so downstream modules can read
        # them, but `strip_internals` drops them on the way out so they don't
        # surface on the public PIPELINE_CONTEXT socket. Useful for "scratch"
        # vars that drive a derivation/combine but shouldn't become
        # prompt-text noise.
        inst = snapshot.get("instance", {}) if isinstance(snapshot, dict) else {}
        mark_internal = (
            bool(inst.get("internal", False)) if isinstance(inst, dict) else False
        )
        writes = _apply_bindings(ctx, bindings, h.type, mark_internal)
        self._trace(
            ctx, h, module, warn_mark, explain,
            status="ok", writes=writes, meta=meta,
            seed=self._effective_seed(ctx, inst),
        )

    @staticmethod
    def _effective_seed(ctx: Context, inst: Any) -> int:
        """The seed THIS module rolled with — `instance.locked_seed` if
        locked, else the chain seed. Surfaces to the frontend via the
        WP_Context node's UI payload so the lock-toggle defaults can grab the
        AUTHORITATIVE value (not the local widget, which lies when the seed
        input is link-driven)."""
        locked = inst.get("locked_seed") if isinstance(inst, dict) else None
        if isinstance(locked, (int, float)):
            return int(locked)
        return int(ctx.get("__wp_node_seed__", 0) or 0)

    @staticmethod
    def _trace(
        ctx: Context,
        h: _ModuleHeader,
        module: ModuleLike,
        warn_mark: int,
        explain: bool,
        *,
        status: str,
        enabled: bool = True,
        writes: list[dict[str, Any]] | None = None,
        error: dict[str, Any] | None = None,
        meta: dict[str, Any] | None = None,
        seed: Any = _NO_SEED,
    ) -> None:
        """Append one module's trace row (plus explain-mode extras)."""
        if meta is None:
            meta = _extract_static_meta(module)
        row: dict[str, Any] = {
            "id": h.id,
            "_uid": h.uid,
            "type": h.type,
            "enabled": enabled,
            "status": status,
            "writes": writes if writes is not None else [],
            "error": error,
        }
        if seed is not _NO_SEED:
            row["seed"] = seed
        row.update(meta)
        if explain:
            row.update(_finish_module(ctx, warn_mark, h.id, h.uid, h.name))
        ctx["__wp_trace__"].append(row)
