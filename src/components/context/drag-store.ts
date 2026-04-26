import { ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";

// Module-scoped reactive state shared across every ContextWidget Vue app
// instance on the page. Each Context node mounts its own Vue app, so we
// can't use provide/inject — but plain module imports give us a single
// source of truth for "what is currently being dragged".
export interface DragPayload {
  sourceNodeId: number;
  module: ModuleEntry;
  /** Set by the receiving node on cross-node drop so source can clean up. */
  consumedBy?: number;
}

export const dragState = ref<DragPayload | null>(null);
