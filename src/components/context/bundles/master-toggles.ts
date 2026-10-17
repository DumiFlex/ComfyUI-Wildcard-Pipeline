import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";
import { isInternal, isInternalable, isLocked, isSeedLockable } from "../module-state";
import type { WidgetState } from "../widget-state";

/**
 * Bundle master toggles — the BundleHeader Lock / Hide buttons. Tri-state
 * aggregation over a bundle's children plus the cascading set/toggle that
 * claims (or releases) direct children and chains into inner bundles.
 */
export function createBundleMasterToggles(
  state: WidgetState,
  props: { readonly lastUsedSeedReader?: (moduleId?: string) => number | null },
) {
  const { value, commitModules } = state;

  /** Tri-state aggregation of `instance.internal` across a bundle's
   *  children. Drives the master-toggle visual in BundleHeader:
   *    - "all"     → every child has internal=true (button pressed)
   *    - "none"    → no child has internal (button neutral)
   *    - "partial" → mixed (button half-pressed, dashed border)
   *
   *  Empty bundle defaults to "none" — the button is harmless to show
   *  but clicking it does nothing (no children to flip). */
  function bundleInternalState(
    bundle: BundleInstance,
  ): "all" | "none" | "partial" | null {
    const mods = value.value.modules;
    let on = 0;
    let total = 0;
    for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
      // Skip kinds that don't support the internal flag (constraint).
      // Otherwise a bundle of one constraint + N internal wildcards
      // would read "partial" forever — the constraint is non-applicable,
      // not "not internal yet." Same skip applied in
      // `toggleBundleInternal` so the cascade matches the aggregation.
      if (!isInternalable(mods[i])) continue;
      total++;
      if (isInternal(mods[i])) on++;
    }
    if (total === 0) return null;
    if (on === 0) return "none";
    if (on === total) return "all";
    return "partial";
  }

  /** Same shape over `locked_seed`, but only the seed-lockable
   *  children count. Returns `null` when the bundle has zero lockable
   *  children — BundleHeader uses that to hide the lock button so a
   *  bundle of fixed_values + constraints (which can't be seed-locked)
   *  doesn't render a no-op control. */
  function bundleLockState(
    bundle: BundleInstance,
  ): "all" | "none" | "partial" | null {
    const mods = value.value.modules;
    let on = 0;
    let total = 0;
    for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
      if (!isSeedLockable(mods[i])) continue;
      total++;
      if (isLocked(mods[i])) on++;
    }
    if (total === 0) return null;
    if (on === 0) return "none";
    if (on === total) return "all";
    return "partial";
  }

  /** OFF resolution mode for nested master cascades.
   *
   *   - "preserve"  → only rows whose `master_internal_by` matches this
   *                    bundle's `_uid` get cleared. Manual-internal rows
   *                    survive. Inner masters reached via recursion ALSO
   *                    run in preserve mode regardless of their own
   *                    claims, so a parent's OFF doesn't accidentally
   *                    sweep an inner bundle's manual rows.
   *   - "cascade"   → every internal row this bundle owns (direct
   *                    children) clears unconditionally. Triggered only
   *                    when the entire scope is hand-marked (no master
   *                    claim anywhere this bundle could see) and the
   *                    user clicks the master button at "all" — they
   *                    almost certainly meant "turn everything off".
   *                    Inner masters receive the same "cascade" so
   *                    inner-owned manual rows clear too. */
  type BundleOffMode = "preserve" | "cascade";

  /** Set `instance.internal` for every direct child of a bundle, then
   *  recurse into inner bundles. See `BundleOffMode` for the OFF
   *  decision matrix.
   *
   *  A bundle's master governs ONLY its direct children — rows owned
   *  by an inner bundle are skipped + the recursive call propagates
   *  the same on/off + mode downward. */
  function setBundleInternal(
    uid: string,
    targetOn: boolean,
    forceMode?: BundleOffMode,
  ): void {
    const bundles = value.value.bundles ?? [];
    const bundle = bundles.find((b) => b._uid === uid);
    if (!bundle) return;
    const innerBundles = bundles.filter((b) => b.parent_uid === bundle._uid);
    const innerUids = new Set(innerBundles.map((b) => b._uid));
    const modules = value.value.modules;
    // OFF-mode decision (forceMode wins on recursive descent). Scan
    // the entire scope for any `master_internal_by` tag — presence
    // anywhere → preserve (some master claimed something, OFF
    // should undo only that). Absence anywhere → cascade (all
    // hand-marked, click OFF at "all" means "really clear all").
    let mode: BundleOffMode = forceMode ?? "preserve";
    if (!targetOn && !forceMode) {
      let hasAnyClaim = false;
      for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
        const m = modules[i];
        if (!m || !isInternalable(m)) continue;
        if (m.instance?._ui?.master_internal_by) {
          hasAnyClaim = true;
          break;
        }
      }
      mode = hasAnyClaim ? "preserve" : "cascade";
    }
    // Track which inners this call should recurse into. Two rules:
    //   ON  — recurse if the inner state was NOT "all" before this op
    //         (we're flipping it from partial/none to all). Tag the
    //         inner with `master_internal_chained_by = bundle._uid`
    //         so its eventual OFF can find us. If inner was already
    //         "all", skip — user/its own master got there independently,
    //         we don't want to "own" inner's pre-existing state.
    //   OFF — recurse only if inner.master_internal_chained_by ===
    //         bundle._uid (we previously chained inner ON). Otherwise
    //         leave inner alone (user-controlled). On recursion, clear
    //         the chain tag.
    type InnerOp = { inner: BundleInstance; chainTag: "set" | "clear" | null };
    const innerOps: InnerOp[] = [];
    for (const inner of innerBundles) {
      if (targetOn) {
        const innerState = bundleInternalState(inner);
        if (innerState !== "all") {
          innerOps.push({ inner, chainTag: "set" });
        }
      } else {
        if (inner.master_internal_chained_by === bundle._uid) {
          innerOps.push({ inner, chainTag: "clear" });
        }
      }
    }
    const list = modules.map((m, i) => {
      if (i < bundle.start_idx || i > bundle.end_idx) return m;
      if (!isInternalable(m)) return m;
      const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
      if (origin && innerUids.has(origin)) return m;
      const inst = m.instance ?? {};
      const ui = inst._ui ?? {};
      if (targetOn) {
        if (inst.internal) return m;
        return {
          ...m,
          instance: {
            ...inst,
            internal: true,
            _ui: { ...ui, master_internal: true, master_internal_by: bundle._uid },
          },
        };
      } else {
        if (!inst.internal) return m;
        // Preserve mode → only clear rows THIS bundle owns. Cascade
        // mode → clear everything in scope regardless of claim.
        if (mode === "preserve" && ui.master_internal_by !== bundle._uid) return m;
        const { internal: _drop, ...restInst } = inst;
        void _drop;
        const { master_internal: _drop2, master_internal_by: _drop3, ...restUi } = ui;
        void _drop2;
        void _drop3;
        return { ...m, instance: { ...restInst, _ui: restUi } };
      }
    });
    // Apply chain-tag updates to inner BundleInstances alongside the
    // module commit. Single commitModules call keeps modules + bundles
    // in lock-step so a subsequent recursive call sees the new flags.
    const tagsByUid = new Map<string, "set" | "clear">();
    for (const op of innerOps) if (op.chainTag) tagsByUid.set(op.inner._uid, op.chainTag);
    const nextBundles = bundles.map((b) => {
      const tag = tagsByUid.get(b._uid);
      if (!tag) return b;
      if (tag === "set") return { ...b, master_internal_chained_by: bundle._uid };
      const { master_internal_chained_by: _drop, ...rest } = b;
      void _drop;
      return rest as BundleInstance;
    });
    commitModules(list, nextBundles);
    // Recurse into inner bundles selected above. Mode propagates so a
    // preserving outer doesn't turn into a cascading inner.
    for (const op of innerOps) {
      setBundleInternal(op.inner._uid, targetOn, mode);
    }
  }

  /** Click handler: aggregation drives the on/off resolution. State
   *  "all" → click OFF (sweep everything in scope); state "none" or
   *  "partial" → click ON (claim every off row + propagate to inner
   *  masters). User-initiated click also clears this bundle's own
   *  `master_internal_chained_by` flag — taking direct action means
   *  the bundle is no longer "owned" by an outer chain. Any future
   *  outer OFF will leave it alone. */
  function toggleBundleInternal(uid: string): void {
    const bundles = value.value.bundles ?? [];
    const bundle = bundles.find((b) => b._uid === uid);
    if (!bundle) return;
    const state = bundleInternalState(bundle);
    if (state === null) return;
    if (bundle.master_internal_chained_by) {
      const nextBundles = bundles.map((b) => {
        if (b._uid !== uid) return b;
        const { master_internal_chained_by: _drop, ...rest } = b;
        void _drop;
        return rest as BundleInstance;
      });
      value.value = { ...value.value, bundles: nextBundles };
    }
    setBundleInternal(uid, state !== "all");
  }

  /** Set seed-lock for every direct child of a bundle, recurse into
   *  inner bundles. Mirrors `setBundleInternal` — see that fn for the
   *  full design rationale (inner-bundle ownership, smart OFF,
   *  cascade-via-recursion). Lock-specific bit: ON uses the
   *  per-instance last-used seed via `lastUsedSeedReader`, then the
   *  `_ui.last_locked_seed` memory, then 0. */
  function setBundleLock(
    uid: string,
    targetOn: boolean,
    forceMode?: BundleOffMode,
  ): void {
    const bundles = value.value.bundles ?? [];
    const bundle = bundles.find((b) => b._uid === uid);
    if (!bundle) return;
    const innerBundles = bundles.filter((b) => b.parent_uid === bundle._uid);
    const innerUids = new Set(innerBundles.map((b) => b._uid));
    const modules = value.value.modules;
    // Same OFF-mode decision matrix as setBundleInternal — see
    // `BundleOffMode` docs above for the full table. Pre-scan covers
    // the ENTIRE scope (not just direct children) so an inner-owned
    // claim correctly forces outer's OFF into preserve mode and
    // saves any hand-locked rows in outer's direct scope.
    let mode: BundleOffMode = forceMode ?? "preserve";
    if (!targetOn && !forceMode) {
      let hasAnyClaim = false;
      for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
        const m = modules[i];
        if (!m || !isSeedLockable(m)) continue;
        if (m.instance?._ui?.master_lock_by) {
          hasAnyClaim = true;
          break;
        }
      }
      mode = hasAnyClaim ? "preserve" : "cascade";
    }
    // Inner chain decisions mirror setBundleInternal. See that fn's
    // commentary for the full rationale.
    type InnerOp = { inner: BundleInstance; chainTag: "set" | "clear" | null };
    const innerOps: InnerOp[] = [];
    for (const inner of innerBundles) {
      if (targetOn) {
        const innerState = bundleLockState(inner);
        if (innerState !== "all") {
          innerOps.push({ inner, chainTag: "set" });
        }
      } else {
        if (inner.master_lock_chained_by === bundle._uid) {
          innerOps.push({ inner, chainTag: "clear" });
        }
      }
    }
    const list = modules.map((m, i) => {
      if (i < bundle.start_idx || i > bundle.end_idx) return m;
      if (!isSeedLockable(m)) return m;
      const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
      if (origin && innerUids.has(origin)) return m;
      const inst = m.instance ?? {};
      const ui = inst._ui ?? {};
      if (targetOn) {
        if (typeof inst.locked_seed === "number") return m;
        let fallback: number;
        const lastUsed = props.lastUsedSeedReader?.(m._uid ?? m.id);
        if (typeof lastUsed === "number") fallback = lastUsed;
        else if (typeof ui.last_locked_seed === "number") fallback = ui.last_locked_seed;
        else fallback = 0;
        return {
          ...m,
          instance: {
            ...inst,
            locked_seed: fallback,
            _ui: {
              ...ui,
              last_locked_seed: fallback,
              master_lock: true,
              master_lock_by: bundle._uid,
            },
          },
        };
      } else {
        if (typeof inst.locked_seed !== "number") return m;
        if (mode === "preserve" && ui.master_lock_by !== bundle._uid) return m;
        const { master_lock: _drop, master_lock_by: _drop2, ...restUi } = ui;
        void _drop;
        void _drop2;
        // DROP the `locked_seed` key entirely — earlier we set it to
        // `null`, which the engine treats identically to missing but
        // the bundle fingerprint distinguishes (stableStringify emits
        // `"locked_seed":null` vs no key at all).
        const { locked_seed: _drop3, ...restInstClean } = inst;
        void _drop3;
        return {
          ...m,
          instance: { ...restInstClean, _ui: restUi },
        };
      }
    });
    const tagsByUid = new Map<string, "set" | "clear">();
    for (const op of innerOps) if (op.chainTag) tagsByUid.set(op.inner._uid, op.chainTag);
    const nextBundles = bundles.map((b) => {
      const tag = tagsByUid.get(b._uid);
      if (!tag) return b;
      if (tag === "set") return { ...b, master_lock_chained_by: bundle._uid };
      const { master_lock_chained_by: _drop, ...rest } = b;
      void _drop;
      return rest as BundleInstance;
    });
    commitModules(list, nextBundles);
    for (const op of innerOps) {
      setBundleLock(op.inner._uid, targetOn, mode);
    }
  }

  function toggleBundleLock(uid: string): void {
    const bundles = value.value.bundles ?? [];
    const bundle = bundles.find((b) => b._uid === uid);
    if (!bundle) return;
    const state = bundleLockState(bundle);
    if (state === null) return;
    // Direct user click clears this bundle's own chain tag — taking
    // ownership decouples it from any outer chain.
    if (bundle.master_lock_chained_by) {
      const nextBundles = bundles.map((b) => {
        if (b._uid !== uid) return b;
        const { master_lock_chained_by: _drop, ...rest } = b;
        void _drop;
        return rest as BundleInstance;
      });
      value.value = { ...value.value, bundles: nextBundles };
    }
    setBundleLock(uid, state !== "all");
  }

  return {
    bundleInternalState,
    bundleLockState,
    toggleBundleInternal,
    toggleBundleLock,
  };
}
