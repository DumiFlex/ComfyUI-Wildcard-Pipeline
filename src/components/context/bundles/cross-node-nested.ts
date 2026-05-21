/**
 * Cross-node bundle insertion with nested-bundle preservation.
 *
 * When a user drags a bundle's header from Context node A to Context
 * node B, the receiver mints fresh BundleInstance objects for both the
 * outer wrapper AND every inner bundle the outer contained. Children's
 * `bundle_origin` is remapped from source uids to the freshly-minted
 * uids so the nesting chain survives the cross-node trip.
 *
 * The receiver in `ContextWidget.vue` calls this helper, then commits
 * `[...existingBundles, newBundle, ...freshInners]` to its widget
 * value. `reconcileBundleRanges` (drag.ts) recomputes start_idx /
 * end_idx for every bundle from the post-splice `bundle_origin` chain
 * — so the placeholder ranges set here (`start_idx: 0, end_idx: -1`
 * for inners) get overwritten on the very next reconcile.
 *
 * Pure function. No DOM, no Vue, no side effects. Receives `newRowUid`
 * + `emptyBundleInstance` as factories so callers control the
 * randomness / shape (tests can inject deterministic counters).
 */

import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

/** Subset of the cross-node bundle drag payload this helper needs.
 *  Mirrors `DragPayload.bundle` from drag-store.ts but only the fields
 *  the receiver consumes — keeps the helper testable without
 *  importing the full drag-store. */
export interface CrossNodeBundlePayload {
  bundleUid: string;
  libraryId: string;
  bundleName: string;
  bundleColor: string | null;
  bundleCollapsed: boolean;
  bundleEnabled: boolean;
  /** Deep-cloned snapshots of every leaf in the bundle's range,
   *  preserving their original `bundle_origin` (which may point at
   *  the outer OR at an inner). The helper rewrites these to the
   *  freshly-minted uids before returning. */
  children: ModuleEntry[];
  /** Inner BundleInstances under this dragged outer
   *  (`parent_uid === bundleUid`). Captured at dragstart time.
   *  May be empty if the outer had no nested children. */
  innerInstances: BundleInstance[];
}

/** Output of `buildCrossNodeBundleInsertion`. The caller splices
 *  `newChildren` into its modules array at `insertIdx`, then commits
 *  `[...bundles, newBundle, ...freshInners]` so reconcile can
 *  recompute ranges. */
export interface CrossNodeBundleResult {
  newBundle: BundleInstance;
  freshInners: BundleInstance[];
  newChildren: ModuleEntry[];
}

export function buildCrossNodeBundleInsertion(
  ds: CrossNodeBundlePayload,
  insertIdx: number,
  outerParentUid: string | null,
  newRowUid: () => string,
  emptyBundleInstance: (libId: string) => BundleInstance,
): CrossNodeBundleResult {
  // Outer BundleInstance — fresh _uid, range pre-computed (reconcile
  // will overwrite). Carries forward instance state (collapsed/enabled
  // + color/name) so the receiver looks identical to the source.
  //
  // `outerParentUid` is the receiver-side container's uid:
  //   - null → drop at top-level (newBundle.parent_uid stays null)
  //   - <uid> → drop INSIDE that bundle's body. newBundle becomes a
  //     nested inner of the receiver bundle. Required so reconcile's
  //     parent-chain envelope keeps the receiver's range contiguous.
  //     Without this, the receiver bundle's range becomes
  //     non-contiguous post-splice (the new leaves point at
  //     newBundle, which has no parent → receiver dissolves).
  const newBundle: BundleInstance = {
    ...emptyBundleInstance(ds.libraryId),
    start_idx: insertIdx,
    end_idx: insertIdx + ds.children.length - 1,
    name: ds.bundleName,
    color: ds.bundleColor,
    collapsed: ds.bundleCollapsed,
    enabled: ds.bundleEnabled,
    parent_uid: outerParentUid,
  };

  // Inner BundleInstances — each gets a fresh _uid. Build map from
  // source-uid → fresh-uid so children's bundle_origin can be
  // remapped consistently. parent_uid points at the NEW outer.
  const innerUidMap = new Map<string, string>();
  const freshInners: BundleInstance[] = ds.innerInstances.map((src) => {
    const freshUid = newRowUid();
    innerUidMap.set(src._uid, freshUid);
    return {
      ...src,
      _uid: freshUid,
      parent_uid: newBundle._uid,
      // Reconcile will recompute from children's bundle_origin chain.
      // Placeholder sentinel so a corrupt skip doesn't accidentally
      // overlap a real range.
      start_idx: 0,
      end_idx: -1,
    };
  });

  // Children — fresh _uid for every leaf. Remap bundle_origin via
  // innerUidMap; leaves whose origin was the source outer or whose
  // origin isn't in the map (e.g. orphan from corrupt source) fall
  // back to the new outer's uid so reconcile keeps them grouped.
  const newChildren = ds.children.map((c) => {
    const fresh = { ...c, _uid: newRowUid() } as ModuleEntry & {
      bundle_origin?: string;
    };
    const srcOrigin = (c as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (srcOrigin && innerUidMap.has(srcOrigin)) {
      fresh.bundle_origin = innerUidMap.get(srcOrigin)!;
    } else {
      fresh.bundle_origin = newBundle._uid;
    }
    return fresh;
  });

  return { newBundle, freshInners, newChildren };
}
