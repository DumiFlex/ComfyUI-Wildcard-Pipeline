/**
 * A cheap "did anything a graph walker reads change?" check.
 *
 * The chain-walking polls (`reactiveFromGraph` with `gated: true`) used to
 * recompute on every 400 ms tick, each one walking its node's whole chain: on
 * a 40-Context chain that saturated the main thread. They now recompute only
 * when the graph REVISION moved. The revision is bumped two ways:
 *
 * - explicitly (`bumpGraphRevision` in reactive.ts): connection changes, mode
 *   changes, workflow load, node add/remove;
 * - by this fingerprint, taken once per shared poll tick: every graph's link
 *   store, every node's identity, mode, title, type, widget values and slot
 *   types, subgraph boundary links, group titles and the preview lookup
 *   cache version. That catches the edits no event reports (a widget typed
 *   into, a Reroute rewired two nodes upstream, an edit inside a subgraph).
 *
 * Reading these is a few array pushes per node: microseconds where a walk per
 * reader cost milliseconds. Values are compared by identity, so a widget
 * string costs a pointer check.
 */
import type { LiteGraphLike, LiteNodeLike } from "./graph";
import { cacheVersion as previewCacheVersion } from "./preview-resolver";

interface FingerprintGraph extends LiteGraphLike {
  _version?: number;
  _groups?: Array<{ title?: string }>;
}

function pushLinks(links: unknown, out: unknown[]): void {
  if (links instanceof Map) {
    out.push(links.size);
    for (const l of links.values()) pushLink(l, out);
  } else if (links && typeof links === "object") {
    const all = Object.values(links as Record<string, unknown>);
    out.push(all.length);
    for (const l of all) pushLink(l, out);
  }
}

function pushLink(l: unknown, out: unknown[]): void {
  if (!l || typeof l !== "object") return;
  const link = l as { id?: unknown; origin_id?: unknown; origin_slot?: unknown; target_id?: unknown; target_slot?: unknown };
  out.push(l, link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot);
}

function pushNode(n: LiteNodeLike, out: unknown[]): void {
  out.push(n, n.id, n.mode, n.type, (n as { title?: unknown }).title);
  const ws = n.widgets;
  if (ws) {
    out.push(ws.length);
    for (const w of ws) out.push(w.value);
  }
  const ins = n.inputs;
  if (ins) {
    out.push(ins.length);
    for (const i of ins) out.push(i.name, i.type);
  }
  const outs = n.outputs;
  if (outs) {
    out.push(outs.length);
    for (const o of outs) out.push(o.name, o.type);
  }
}

/** Append the fingerprint of `root` and every subgraph reachable from it. */
export function collectFingerprint(root: LiteGraphLike, out: unknown[]): void {
  out.push(previewCacheVersion.value);
  const seen = new Set<LiteGraphLike>();
  const visit = (g: FingerprintGraph): void => {
    if (seen.has(g)) return;
    seen.add(g);
    out.push(g, g._version, g._nodes?.length);
    pushLinks(g.links, out);
    for (const io of [g.inputNode, g.outputNode]) {
      if (!io) continue;
      for (const s of io.slots ?? []) {
        out.push(s.name);
        for (const id of s.linkIds ?? []) out.push(id);
      }
    }
    const groups = g._groups;
    if (Array.isArray(groups)) {
      out.push(groups.length);
      for (const gr of groups) out.push(gr?.title);
    }
    for (const n of g._nodes ?? []) {
      pushNode(n, out);
      if (n.subgraph) visit(n.subgraph as FingerprintGraph);
    }
  };
  visit(root as FingerprintGraph);
}

/** Compare `next` with `prev` element by element (identity). */
export function sameFingerprint(prev: readonly unknown[], next: readonly unknown[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return false;
  return true;
}
