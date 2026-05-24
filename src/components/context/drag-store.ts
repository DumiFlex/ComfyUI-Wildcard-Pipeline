import { ref } from "vue";
import type { BundleInstance, ModuleEntry } from "../../widgets/_shared";

// Module-scoped reactive state shared across every ContextWidget Vue app
// instance on the page. Each Context node mounts its own Vue app, so we
// can't use provide/inject — but plain module imports give us a single
// source of truth for "what is currently being dragged".
//
// Discriminated union by `kind`:
//   - "module" — dragging a single module row (existing behavior since Phase B).
//   - "bundle" — dragging a whole bundle as a unit via its header handle.
//     Carries the BundleInstance _uid + pre-drag range; receiver re-slices
//     by index range and re-stamps start_idx / end_idx after the move.
export type DragPayload =
  | {
      kind: "module";
      sourceNodeId: number;
      module: ModuleEntry;
      sourceIdx: number;
      sourceBundleUid: string | null;
      /** Set by the receiving node on cross-node drop so source can clean up. */
      consumedBy?: number;
    }
  | {
      kind: "bundle";
      sourceNodeId: number;
      bundleUid: string;
      sourceStartIdx: number;
      sourceEndIdx: number;
      /** Library entry id — receiver re-uses to attach new BundleInstance. */
      libraryId: string;
      /** Denormalized name + color at drag time for the new BundleInstance. */
      bundleName: string;
      bundleColor: string | null;
      /** Per-instance state carried across the cross-node drop so the
       *  receiver doesn't reset collapsed/disabled bundles to defaults. */
      bundleCollapsed: boolean;
      bundleEnabled: boolean;
      /** Deep snapshots of the bundle's children (in order). Receiver
       *  splices these into its modules array + stamps fresh `_uid`
       *  + `bundle_origin` on each. Each child's `bundle_origin`
       *  carries the SOURCE uid (outer or inner) so the receiver can
       *  remap to fresh uids and preserve the nesting chain. */
      children: ModuleEntry[];
      /** Inner BundleInstances under the dragged outer
       *  (`parent_uid === bundleUid`). Tier-2 cap: at most one level
       *  of nesting; this array holds the SIBLING inners under the
       *  outer. Empty when the outer is flat. Receiver mints fresh
       *  uids per inner and remaps each child's `bundle_origin` via
       *  the source-uid → fresh-uid map. */
      innerInstances: BundleInstance[];
      consumedBy?: number;
    };

export const dragState = ref<DragPayload | null>(null);

/** Pending cross-node module/bundle handoff that the source widget
 *  hasn't yet cleaned up. Belt-and-suspenders for the source widget's
 *  `dragend` listener — that handler is the primary cleanup path but
 *  has been observed to miss intermittently when the drag originates
 *  from a row whose ancestor (bundle frame, transition group) churns
 *  the DOM during the same tick. Each entry tags the source widget
 *  (`sourceNodeId`) and a `_uid` (modules) or `bundleUid` (bundles)
 *  so the source widget can filter-and-remove on its next reactive
 *  tick. Consumed entries are deleted immediately to avoid double
 *  splices when both pathways fire.
 *
 *  Bundle handoff carries `sourceStartIdx`/`sourceEndIdx` instead of
 *  a single uid so the source widget can splice the whole range it
 *  no longer owns. */
export interface PendingHandoff {
  kind: "module" | "bundle";
  sourceNodeId: number;
  /** Per-instance row uid (module) — source filters its modules[] by this. */
  uid?: string;
  /** Bundle uid + range — source splices this exact slice. */
  bundleUid?: string;
  sourceStartIdx?: number;
  sourceEndIdx?: number;
}

export const pendingHandoffs = ref<PendingHandoff[]>([]);

export function queueHandoff(h: PendingHandoff): void {
  pendingHandoffs.value = [...pendingHandoffs.value, h];
}

export function takeHandoffsFor(sourceNodeId: number): PendingHandoff[] {
  const out: PendingHandoff[] = [];
  const rest: PendingHandoff[] = [];
  for (const h of pendingHandoffs.value) {
    if (h.sourceNodeId === sourceNodeId) out.push(h);
    else rest.push(h);
  }
  if (out.length > 0) pendingHandoffs.value = rest;
  return out;
}
