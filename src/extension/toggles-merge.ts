/**
 * "Merge into WP Toggles": replace selected on/off nodes with one WP Toggles.
 *
 * No list of node types: a node qualifies when its only output is BOOLEAN,
 * nothing is wired into it and it has exactly one on/off widget (ComfyUI's
 * Boolean, a Primitive set to BOOLEAN, most pack toggles). Each becomes a
 * toggle named after its title, keeps its value, and its wires move to the
 * new node's matching output. One undo step.
 */
import { MAX_OUTPUTS, newToggleId, uniqueVar, varFromName, type ToggleRow, type TogglesConfig } from "./toggles";

interface MergeWidget { name: string; type?: string; value?: unknown }
interface MergeLink { target_id: number | string; target_slot: number }
interface MergeNode {
  id: number | string;
  type?: string;
  title?: string;
  pos: number[];
  inputs?: { link?: number | null }[];
  outputs?: { type?: string; links?: number[] | null }[];
  widgets?: MergeWidget[];
  constructor: { title?: string };
  connect?: (slot: number, target: MergeNode, targetSlot: number) => unknown;
}
export interface MergeGraph {
  add(node: MergeNode): unknown;
  remove(node: MergeNode): void;
  getNodeById(id: number | string): MergeNode | null | undefined;
  links: Map<number, MergeLink> | Record<number, MergeLink | undefined>;
  beforeChange?: () => void;
  afterChange?: () => void;
}

function boolWidgets(node: MergeNode): MergeWidget[] {
  return (node.widgets ?? []).filter((w) => typeof w.value === "boolean");
}

/** Can this node become a toggle? */
export function isMergeable(node: MergeNode): boolean {
  if (node.type === "WP_Toggles") return false;
  const outs = node.outputs ?? [];
  if (outs.length !== 1 || outs[0].type !== "BOOLEAN") return false;
  if ((node.inputs ?? []).some((i) => i.link != null)) return false;
  return boolWidgets(node).length === 1;
}

/** The toggle a node turns into (a default title gets "Toggle N"). */
export function toggleFor(node: MergeNode, cfg: TogglesConfig, n: number): ToggleRow {
  const title = (node.title ?? "").trim();
  const generic = !title || title === node.constructor.title || title === node.type;
  const name = generic ? `Toggle ${n}` : title;
  return {
    id: newToggleId(),
    kind: "toggle",
    name,
    var: uniqueVar(varFromName(name) || `toggle_${n}`, cfg),
    on: boolWidgets(node)[0]?.value === true,
    pin: true,
    out: n,
    style: "switch",
  };
}

export function mergedConfig(nodes: MergeNode[]): TogglesConfig {
  const cfg: TogglesConfig = { version: 1, mode: "any", group_var: "", rows: [] };
  nodes.slice(0, MAX_OUTPUTS).forEach((node, i) => cfg.rows.push(toggleFor(node, cfg, i + 1)));
  return cfg;
}

function linkOf(graph: MergeGraph, id: number): MergeLink | undefined {
  const links = graph.links;
  return links instanceof Map ? links.get(id) : links[id];
}

/**
 * Merge `selected` (the mergeable ones, up to 16, top to bottom) into a new
 * node made by `create`. Returns the names of the nodes left as they were.
 */
export function mergeIntoToggles(
  graph: MergeGraph,
  selected: MergeNode[],
  create: () => MergeNode | null,
): { merged: number; skipped: string[] } {
  const ok = selected.filter(isMergeable).sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
  const take = ok.slice(0, MAX_OUTPUTS);
  const skipped = selected.filter((n) => !take.includes(n)).map((n) => n.title || n.type || String(n.id));
  if (!take.length) return { merged: 0, skipped };
  const node = create();
  if (!node) return { merged: 0, skipped: selected.map((n) => n.title || String(n.id)) };
  graph.beforeChange?.();
  try {
    node.pos = [Math.min(...take.map((n) => n.pos[0])), Math.min(...take.map((n) => n.pos[1]))];
    graph.add(node);
    const value = node.widgets?.find((w) => w.name === "wp_toggles");
    if (value) value.value = JSON.stringify(mergedConfig(take));
    take.forEach((old, i) => {
      const targets = (old.outputs?.[0]?.links ?? [])
        .map((id) => linkOf(graph, id))
        .filter((l): l is MergeLink => !!l)
        .map((l) => [graph.getNodeById(l.target_id), l.target_slot] as const);
      graph.remove(old);
      for (const [target, slot] of targets) if (target) node.connect?.(i + 1, target, slot);
    });
  } finally {
    graph.afterChange?.();
  }
  return { merged: take.length, skipped };
}
