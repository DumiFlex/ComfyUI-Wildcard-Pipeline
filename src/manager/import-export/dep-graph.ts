/**
 * Outgoing-direction dependency graph computed from a parsed payload.
 *
 *   - Wildcard option value `@{uuid}` refs → outgoing edge
 *   - Bundle children[].uuid (for bundle-typed children, tier-2 refs) → outgoing edge
 *   - Constraint source_uuid + target_uuid → outgoing edges
 *
 * Pure function. No I/O. Used by picker UI for dep-indicator rendering
 * and by the `Select with dependencies` action.
 */

import type { RawPayload } from "./migrations";

const REF_REGEX = /@\{([0-9a-f]{8})(?::[^}]*)?\}/g;

export type DepGraph = Record<string, string[]>;

function extractRefsFromText(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  REF_REGEX.lastIndex = 0;
  while ((m = REF_REGEX.exec(text)) !== null) found.add(m[1]!);
  return [...found];
}

export function buildDepGraph(payload: RawPayload): DepGraph {
  const graph: DepGraph = {};
  for (const w of payload.wildcards) {
    const wid = (w as { uuid: string }).uuid;
    const edges = new Set<string>();
    const options = (w as { options?: Array<{ value: string }> }).options ?? [];
    for (const opt of options) {
      for (const ref of extractRefsFromText(opt.value)) edges.add(ref);
    }
    graph[wid] = [...edges];
  }
  for (const b of payload.bundles) {
    const bid = (b as { uuid: string }).uuid;
    const children = (b as { children?: Array<{ uuid: string; type: string }> }).children ?? [];
    graph[bid] = children.filter((c) => c.type === "bundle").map((c) => c.uuid);
  }
  for (const v of payload.fixed_values) {
    graph[(v as { uuid: string }).uuid] = [];
  }
  for (const v of payload.combines) {
    graph[(v as { uuid: string }).uuid] = [];
  }
  for (const v of payload.derivations) {
    graph[(v as { uuid: string }).uuid] = [];
  }
  for (const v of payload.categories) {
    graph[(v as { uuid: string }).uuid] = [];
  }
  for (const c of payload.constraints) {
    const cid = (c as { uuid: string }).uuid;
    const src = (c as { source_uuid?: string }).source_uuid;
    const tgt = (c as { target_uuid?: string }).target_uuid;
    graph[cid] = [src, tgt].filter((x): x is string => Boolean(x));
  }
  return graph;
}

/** Walk outgoing refs from `seed` to fixed point. Two forms:
 *  - `(payload, seed)`: convenience — builds graph internally. O(N+E) extra work.
 *  - `(graph, seed)`: efficient — caller passes a cached `buildDepGraph(payload)`.
 *    Use this in picker UIs that compute the graph once and reuse for many
 *    selection-change recomputes.
 */
export function transitiveClosure(graph: DepGraph, seed: Set<string>): Set<string>;
export function transitiveClosure(payload: RawPayload, seed: Set<string>): Set<string>;
export function transitiveClosure(
  graphOrPayload: DepGraph | RawPayload,
  seed: Set<string>,
): Set<string> {
  // Distinguish RawPayload from DepGraph: RawPayload has the `bundles` array.
  const graph: DepGraph =
    "bundles" in graphOrPayload && Array.isArray((graphOrPayload as RawPayload).bundles)
      ? buildDepGraph(graphOrPayload as RawPayload)
      : (graphOrPayload as DepGraph);
  const visited = new Set<string>(seed);
  const queue: string[] = [...seed];
  while (queue.length > 0) {
    const uid = queue.shift()!;
    const edges = graph[uid] ?? [];
    for (const target of edges) {
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return visited;
}

/** Constraints whose source AND target are both in `selection`. */
export function constraintsBothSidesIn(payload: RawPayload, selection: Set<string>): string[] {
  const matches: string[] = [];
  for (const c of payload.constraints) {
    const cid = (c as { uuid: string }).uuid;
    const src = (c as { source_uuid?: string }).source_uuid;
    const tgt = (c as { target_uuid?: string }).target_uuid;
    if (src && tgt && selection.has(src) && selection.has(tgt)) matches.push(cid);
  }
  return matches;
}
