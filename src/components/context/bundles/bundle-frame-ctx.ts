import type { InjectionKey, Ref } from "vue";
import type { BundleInstance } from "../../../widgets/_shared";
import type { BundleAlerts } from "./bundle-alerts";

/** Shared state + handlers ContextWidget provides for any BundleFrame
 *  descendant to inject. Keeps the recursive frame component free of
 *  prop firehoses — every bundle-level action lives behind this ctx
 *  whether the frame is top-level or nested.
 *
 *  Cascade actions (lock / internal) operate on the bundle's OWN child
 *  range only. Outer + inner each call the same handler with their own
 *  _uid; the handler walks `[start_idx..end_idx]` of THAT bundle, so
 *  the cascade naturally scopes correctly without the frame needing
 *  to know whether it's nested.
 */
export interface BundleFrameCtx {
  bundleChildDriftCount: (b: BundleInstance) => number;
  isBundleLibraryDrifted: (b: BundleInstance) => boolean;
  /** True when the bundle's library_id no longer exists in the polled
   *  bundleHashes map — the library entry has been deleted upstream.
   *  Drives the bundle's MISSING badge, equivalent to the per-module
   *  MISSING dot but at bundle scope. */
  isBundleMissingFromLibrary: (b: BundleInstance) => boolean;
  bundleInternalState: (b: BundleInstance) => "all" | "none" | "partial" | null;
  bundleLockState: (b: BundleInstance) => "all" | "none" | "partial" | null;
  /** Returns "before"/"after" when this bundle is the indicator anchor
   *  for the current slot zone, null otherwise. Drives the
   *  kit's `wp-rowdrag--before`/`--after` class (row-drag.css): a gap
   *  opens with the drop line in it. */
  bundleHeaderGap: (uid: string) => "before" | "after" | null;
  /** The drop line's colour variable when this frame anchors the drop. */
  bundleLineStyle: (uid: string) => Record<string, string> | undefined;
  /** True when the drop goes into this CLOSED bundle (opens on drop). */
  isBundleDropInto: (uid: string) => boolean;
  /** `_uid` of the bundle being dragged by its header (its frame dims). */
  draggingBundleUid: Ref<string | null>;
  /** True when the current drag's resolved slot zone targets THIS
   *  bundle's body — i.e. the drop will land inside this bundle. Drives
   *  a frame-level highlight (ring + tinted background) so users get a
   *  glance-readable "this is the receiving container" affordance,
   *  whether they're dropping a leaf, an inner bundle, or a top-level
   *  bundle becoming a nested inner. */
  isBundleDropTarget: (uid: string) => boolean;
  /** True when this bundle's local children diverge from the snapshot
   *  fingerprint captured at insert/save/reset. Drives the "modified"
   *  badge on the bundle header — equivalent UX grammar to the
   *  per-module MOD dot, but at bundle scope. False when no
   *  fingerprint is stored yet (backfill case). */
  isBundleSnapshotModified: (b: BundleInstance) => boolean;
  /** Worst conflict + library state among the rows the bundle holds. A
   *  collapsed header shows them as dots, so trouble inside stays visible. */
  bundleAlerts: (b: BundleInstance) => BundleAlerts;
  recentDropUids: Ref<Set<string>>;
  pulseDelayFor: (uid: string | null | undefined) => string;
  toggleBundleCollapsed: (uid: string) => void;
  toggleBundleEnabled: (uid: string, next: boolean) => void;
  toggleBundleInternal: (uid: string) => void;
  toggleBundleLock: (uid: string) => void;
  removeBundle: (uid: string) => void;
  openBundleContextMenu: (ev: MouseEvent, uid: string) => void;
  onBundleDragStart: (ev: DragEvent, uid: string) => void;
  onDragEnd: () => void;
}

export const BundleFrameCtxKey: InjectionKey<BundleFrameCtx> = Symbol("bundleFrameCtx");
