/**
 * Count uuid instances across the entire workflow — every WP_Context
 * node, including those nested inside subgraphs. Used by the save-to-
 * library fork-detection path: count > 1 → save creates a new library
 * entry instead of overwriting the shared one.
 *
 * Walk uses the existing `walkAllNodes` helper from `extension/graph.ts`
 * which already handles subgraph traversal.
 */
import { walkAllNodes } from "../../../extension/graph";
import type { LiteGraphLike } from "../../../extension/graph";

export function workflowSiblingCount(uuid: string, rootGraph: LiteGraphLike): number {
  let count = 0;
  for (const { node } of walkAllNodes(rootGraph)) {
    if ((node as { type?: string }).type !== "WP_Context") continue;
    const widgets = (node as { widgets?: unknown[] }).widgets ?? [];
    for (const w of widgets) {
      const widget = w as { type?: string; value?: { modules?: Array<{ id?: string }> } };
      if (widget.type !== "WP_CONTEXT_MODULES") continue;
      const modules = widget.value?.modules;
      if (!Array.isArray(modules)) continue;
      for (const m of modules) {
        if (m?.id === uuid) count++;
      }
    }
  }
  return count;
}
