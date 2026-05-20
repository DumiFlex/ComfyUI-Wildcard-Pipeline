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
  isBundleInsideTarget: (uid: string) => boolean;
  bundleHeaderGap: (uid: string) => "before" | null;
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
