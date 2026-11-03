/**
 * The canvas side of the `wp:library` button: find the WP Contexts in
 * scope and judge their rows against the live library (drift store).
 */
import { parseWidgetJson, type ContextWidgetValue } from "../../widgets/_shared";
import { findRootGraph, walkAllNodes, type LiteGraphLike, type LiteNodeLike } from "../../extension/graph";
import { assignCodenames } from "../../extension/node-codename";
import { bundleHashes, hashes } from "../context/drift-store";
import { isBundleLibraryDrifted, isBundleMissingFromLibrary, matchStateOf } from "../context/library-status";
import type { ContextSource, Verdicts } from "./note-library-plan";

export interface CanvasContext extends ContextSource {
  node: LiteNodeLike;
  /** The raw widget value, to put back on Undo. */
  raw: string;
  label: string;
}

const WIDGET = "wp_modules";

/** A node's key: its id, or `<subgraph id>:<id>` inside a subgraph. */
function keyOf(root: LiteGraphLike, graph: LiteGraphLike, node: LiteNodeLike): string {
  return graph === root || !graph.id ? String(node.id) : `${graph.id}:${node.id}`.toLowerCase();
}

/** Every WP Context on the canvas (subgraphs included), or the one whose
 *  key is `only`. */
export function canvasContexts(graph: unknown, only = ""): CanvasContext[] {
  if (!graph || typeof graph !== "object" || !("_nodes" in graph)) return [];
  const root = findRootGraph(graph as LiteGraphLike);
  const found: Array<{ graph: LiteGraphLike; node: LiteNodeLike }> = [];
  for (const hit of walkAllNodes(root)) if (hit.node.type === "WP_Context") found.push(hit);
  const names = assignCodenames(found.map((f) => f.node.id));
  const out: CanvasContext[] = [];
  for (const { graph: g, node } of found) {
    const key = keyOf(root, g, node);
    if (only && key !== only) continue;
    const w = node.widgets?.find((x) => x.name === WIDGET);
    const raw = typeof w?.value === "string" ? w.value : "";
    const value = parseWidgetJson<ContextWidgetValue>(raw, { version: 1, modules: [] });
    const code = names.get(String(node.id)) ?? `#${node.id}`;
    const title = node.title && node.title !== "WP Context" ? node.title : "WP Context";
    out.push({ key, node, raw, value, label: `${title} · ${code}${g === root ? "" : " (in a subgraph)"}` });
  }
  return out;
}

/** True once the first library poll has landed. */
export function libraryKnown(): boolean {
  return hashes.value !== null && bundleHashes.value !== null;
}

/** The live library verdicts (read them only after `libraryKnown`). */
export const liveVerdicts: Verdicts = {
  module(m) {
    switch (matchStateOf(m)) {
      case null: return "local";
      case "no-collision": return "missing";
      case "conflict": return "different";
      case "type-conflict": return "taken";
      default: return "same";
    }
  },
  bundle(b) {
    if (isBundleMissingFromLibrary(b)) return "missing";
    return isBundleLibraryDrifted(b) ? "different" : "same";
  },
};

/** Write a Context's widget value back (the widget pushes it into its UI). */
export function writeContext(node: LiteNodeLike, json: string): void {
  const w = node.widgets?.find((x) => x.name === WIDGET);
  if (!w) return;
  w.value = json;
  (node.graph as { setDirtyCanvas?: (fg: boolean, bg: boolean) => void } | undefined)?.setDirtyCanvas?.(true, true);
}
