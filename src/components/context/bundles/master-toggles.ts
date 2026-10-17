import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";
import { isInternal, isInternalable, isLocked, isSeedLockable } from "../module-state";
import type { WidgetState } from "../widget-state";

type Tri = "all" | "none" | "partial" | null;

/** OFF resolution mode for nested master cascades.
 *
 *   - "preserve"  → only rows whose claim (`master_internal_by` /
 *                    `master_lock_by`) matches this bundle's `_uid` get
 *                    cleared. Manual rows survive. Inner masters reached
 *                    via recursion ALSO run in preserve mode regardless
 *                    of their own claims, so a parent's OFF doesn't
 *                    accidentally sweep an inner bundle's manual rows.
 *   - "cascade"   → every flagged row this bundle owns (direct
 *                    children) clears unconditionally. Triggered only
 *                    when the entire scope is hand-marked (no master
 *                    claim anywhere this bundle could see) and the
 *                    user clicks the master button at "all" — they
 *                    almost certainly meant "turn everything off".
 *                    Inner masters receive the same "cascade" so
 *                    inner-owned manual rows clear too. */
type BundleOffMode = "preserve" | "cascade";

/** One master button: which rows it applies to, how a row reads as on,
 *  and the instance / `_ui` / BundleInstance keys it writes. */
interface Master {
  applies(m: ModuleEntry): boolean;
  /** Aggregation read (drives the button's tri-state). */
  isOn(m: ModuleEntry): boolean;
  /** Raw "already on" read of a row's instance during a set. */
  has(inst: Record<string, unknown>): boolean;
  field: "internal" | "locked_seed";
  flag: "master_internal" | "master_lock";
  claim: "master_internal_by" | "master_lock_by";
  chain: "master_internal_chained_by" | "master_lock_chained_by";
  /** Lock only: ON writes a seed (and remembers it in `last_locked_seed`). */
  seed?: true;
}

/** Skips kinds that don't support the internal flag (constraint).
 *  Otherwise a bundle of one constraint + N internal wildcards would read
 *  "partial" forever — the constraint is non-applicable, not "not
 *  internal yet." The cascade uses the same skip so it matches the
 *  aggregation. */
const INTERNAL: Master = {
  applies: isInternalable,
  isOn: isInternal,
  has: (inst) => !!inst.internal,
  field: "internal",
  flag: "master_internal",
  claim: "master_internal_by",
  chain: "master_internal_chained_by",
};

/** Only the seed-lockable children count, so a bundle of fixed_values +
 *  constraints with nothing lockable reads `null` and BundleHeader hides
 *  the lock button instead of rendering a no-op control. */
const LOCK: Master = {
  applies: isSeedLockable,
  isOn: isLocked,
  has: (inst) => typeof inst.locked_seed === "number",
  field: "locked_seed",
  flag: "master_lock",
  claim: "master_lock_by",
  chain: "master_lock_chained_by",
  seed: true,
};

function dropChainTag(b: BundleInstance, spec: Master): BundleInstance {
  const { [spec.chain]: _drop, ...rest } = b;
  void _drop;
  return rest as BundleInstance;
}

/**
 * Bundle master toggles — the BundleHeader Lock / Hide buttons. Tri-state
 * aggregation over a bundle's children plus the cascading set/toggle that
 * claims (or releases) direct children and chains into inner bundles. Both
 * buttons run the same machine over their own keys (`INTERNAL` / `LOCK`).
 */
export function createBundleMasterToggles(
  state: WidgetState,
  props: { readonly lastUsedSeedReader?: (moduleId?: string) => number | null },
) {
  const { value, commitModules } = state;

  /** Tri-state aggregation across a bundle's applicable children:
   *    - "all"     → every one is on (button pressed)
   *    - "none"    → none is (button neutral)
   *    - "partial" → mixed (button half-pressed, dashed border)
   *    - null      → no applicable child (button hidden / inert) */
  function aggregate(spec: Master, bundle: BundleInstance): Tri {
    const mods = value.value.modules;
    let on = 0;
    let total = 0;
    for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
      if (!spec.applies(mods[i])) continue;
      total++;
      if (spec.isOn(mods[i])) on++;
    }
    if (total === 0) return null;
    if (on === 0) return "none";
    if (on === total) return "all";
    return "partial";
  }

  /** Set the flag for every direct child of a bundle, then recurse into
   *  inner bundles. See `BundleOffMode` for the OFF decision matrix.
   *
   *  A bundle's master governs ONLY its direct children — rows owned
   *  by an inner bundle are skipped + the recursive call propagates
   *  the same on/off + mode downward. Lock ON uses the per-instance
   *  last-used seed via `lastUsedSeedReader`, then the
   *  `_ui.last_locked_seed` memory, then 0. */
  function setBundleMaster(
    spec: Master,
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
    // the ENTIRE scope (not just direct children) for any claim tag —
    // presence anywhere → preserve (some master claimed something, OFF
    // should undo only that, and an inner-owned claim saves hand-marked
    // rows in this bundle's direct scope). Absence anywhere → cascade
    // (all hand-marked, click OFF at "all" means "really clear all").
    let mode: BundleOffMode = forceMode ?? "preserve";
    if (!targetOn && !forceMode) {
      let hasAnyClaim = false;
      for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
        const m = modules[i];
        if (!m || !spec.applies(m)) continue;
        if (m.instance?._ui?.[spec.claim]) {
          hasAnyClaim = true;
          break;
        }
      }
      mode = hasAnyClaim ? "preserve" : "cascade";
    }
    // Track which inners this call should recurse into. Two rules:
    //   ON  — recurse if the inner state was NOT "all" before this op
    //         (we're flipping it from partial/none to all). Tag the
    //         inner with the chain key = bundle._uid so its eventual
    //         OFF can find us. If inner was already "all", skip —
    //         user/its own master got there independently, we don't
    //         want to "own" inner's pre-existing state.
    //   OFF — recurse only if the inner's chain key === bundle._uid (we
    //         previously chained inner ON). Otherwise leave inner alone
    //         (user-controlled). On recursion, clear the chain tag.
    const innerOps: BundleInstance[] = [];
    for (const inner of innerBundles) {
      if (targetOn ? aggregate(spec, inner) !== "all" : inner[spec.chain] === bundle._uid) {
        innerOps.push(inner);
      }
    }
    const list = modules.map((m, i) => {
      if (i < bundle.start_idx || i > bundle.end_idx) return m;
      if (!spec.applies(m)) return m;
      const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
      if (origin && innerUids.has(origin)) return m;
      const inst = (m.instance ?? {}) as Record<string, unknown>;
      const ui = (inst._ui ?? {}) as Record<string, unknown>;
      if (targetOn) {
        if (spec.has(inst)) return m;
        let on: unknown = true;
        let remembered: Record<string, unknown> = {};
        if (spec.seed) {
          const lastUsed = props.lastUsedSeedReader?.(m._uid ?? m.id);
          on = typeof lastUsed === "number" ? lastUsed
            : typeof ui.last_locked_seed === "number" ? ui.last_locked_seed
            : 0;
          remembered = { last_locked_seed: on };
        }
        return {
          ...m,
          instance: {
            ...inst,
            [spec.field]: on,
            _ui: { ...ui, ...remembered, [spec.flag]: true, [spec.claim]: bundle._uid },
          },
        } as ModuleEntry;
      }
      if (!spec.has(inst)) return m;
      // Preserve mode → only clear rows THIS bundle owns. Cascade
      // mode → clear everything in scope regardless of claim.
      if (mode === "preserve" && ui[spec.claim] !== bundle._uid) return m;
      // DROP the key entirely — a `null` locked_seed reads the same to
      // the engine but the bundle fingerprint distinguishes it
      // (stableStringify emits `"locked_seed":null` vs no key at all).
      const { [spec.field]: _drop, ...restInst } = inst;
      const { [spec.flag]: _drop2, [spec.claim]: _drop3, ...restUi } = ui;
      void _drop;
      void _drop2;
      void _drop3;
      return { ...m, instance: { ...restInst, _ui: restUi } } as ModuleEntry;
    });
    // Apply chain-tag updates to inner BundleInstances alongside the
    // module commit. Single commitModules call keeps modules + bundles
    // in lock-step so a subsequent recursive call sees the new flags.
    const tagged = new Set(innerOps.map((b) => b._uid));
    const nextBundles = bundles.map((b) => {
      if (!tagged.has(b._uid)) return b;
      return targetOn ? { ...b, [spec.chain]: bundle._uid } : dropChainTag(b, spec);
    });
    commitModules(list, nextBundles);
    // Recurse into inner bundles selected above. Mode propagates so a
    // preserving outer doesn't turn into a cascading inner.
    for (const inner of innerOps) {
      setBundleMaster(spec, inner._uid, targetOn, mode);
    }
  }

  /** Click handler: aggregation drives the on/off resolution. State
   *  "all" → click OFF (sweep everything in scope); state "none" or
   *  "partial" → click ON (claim every off row + propagate to inner
   *  masters). User-initiated click also clears this bundle's own
   *  chain tag — taking direct action means the bundle is no longer
   *  "owned" by an outer chain. Any future outer OFF will leave it
   *  alone. */
  function toggleBundleMaster(spec: Master, uid: string): void {
    const bundles = value.value.bundles ?? [];
    const bundle = bundles.find((b) => b._uid === uid);
    if (!bundle) return;
    const tri = aggregate(spec, bundle);
    if (tri === null) return;
    if (bundle[spec.chain]) {
      value.value = {
        ...value.value,
        bundles: bundles.map((b) => (b._uid === uid ? dropChainTag(b, spec) : b)),
      };
    }
    setBundleMaster(spec, uid, tri !== "all");
  }

  return {
    bundleInternalState: (b: BundleInstance) => aggregate(INTERNAL, b),
    bundleLockState: (b: BundleInstance) => aggregate(LOCK, b),
    toggleBundleInternal: (uid: string) => toggleBundleMaster(INTERNAL, uid),
    toggleBundleLock: (uid: string) => toggleBundleMaster(LOCK, uid),
  };
}
