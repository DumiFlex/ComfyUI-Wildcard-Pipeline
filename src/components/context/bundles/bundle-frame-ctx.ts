import type { InjectionKey, Ref } from "vue";
import type { BundleInstance } from "../../../widgets/_shared";

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
  bundleInternalState: (b: BundleInstance) => "all" | "none" | "partial" | null;
  bundleLockState: (b: BundleInstance) => "all" | "none" | "partial" | null;
  /** Returns "before"/"after" when this bundle is the indicator anchor
   *  for the current slot zone, null otherwise. Drives the
   *  `wp-gap-before`/`wp-gap-after` margin class so a gap opens for the
   *  drop-bar. */
  bundleHeaderGap: (uid: string) => "before" | "after" | null;
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
  /** Returns the drop-indicator position for a given container scope.
   *  `containerUid = null` means the top-level list. Returns null when
   *  the resolved zone doesn't target this container — caller hides the
   *  bar. ContextWidget owns the dragOver ref + DOM rect math; this
   *  ctx surfaces the per-container slice. */
  dropBarFor: (containerUid: string | null) => { top: number } | null;
}

export const BundleFrameCtxKey: InjectionKey<BundleFrameCtx> = Symbol("bundleFrameCtx");
