import { ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";

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
      consumedBy?: number;
    };

export const dragState = ref<DragPayload | null>(null);
