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
