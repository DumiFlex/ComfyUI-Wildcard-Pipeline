/**
 * Outgoing-direction dependency graph computed from a parsed payload.
 *
 *   - Wildcard option value `@{id}` refs → outgoing edge
 *   - Bundle children[].id (for bundle-typed children, tier-2 refs) → outgoing edge
 *   - Constraint payload.source_wildcard_id + payload.target_wildcard_id → outgoing edges
 *
 * Pure function. No I/O. Used by picker UI for dep-indicator rendering
 * and by the `Select with dependencies` action.
 *
 * Entity-key convention: every entity row in the parsed payload carries
 * its 8-hex short UUID under the `id` field (per migration 004 of the
 * SQLite schema and `engine/exporter.py`). The `REF_REGEX` name is kept
 * for historical reasons — it still matches the `@{8hex}` syntax in
 * option values; the regex's match group is just a hex string, not
 * field-named.
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
    const wid = (w as { id: string }).id;
    const edges = new Set<string>();
    // Two shapes coexist for wildcard rows:
    //   1) Export-side (after `liveLibraryToRawPayload` flattens): `options`
    //      lives at the top of the entity.
    //   2) Import-side (raw payload from `parsePayload`): `options` is
    //      nested under the entity's `payload` field — same shape the
    //      server's `_row_to_module` returns.
    //
    // Read both, preferring the top-level form when both are present.
    // Without the fallback, the Import side's "Requires N" amber chip
    // never fires because every wildcard reports zero outgoing edges.
    const topLevelOptions =
      (w as { options?: Array<{ value: string }> }).options;
    const nestedOptions =
      (w as { payload?: { options?: Array<{ value: string }> } }).payload?.options;
    const options = topLevelOptions ?? nestedOptions ?? [];
    for (const opt of options) {
      // Guard against malformed payloads where opt.value may be null,
      // undefined, or non-string. The cast above asserts `string` but does
      // not enforce it, so skip non-string values defensively.
      if (typeof opt?.value !== "string") continue;
      for (const ref of extractRefsFromText(opt.value)) edges.add(ref);
    }
    graph[wid] = [...edges];
  }
  for (const b of payload.bundles) {
    const bid = (b as { id: string }).id;
    const children = (b as { children?: Array<{ id: string; type: string }> }).children ?? [];
    graph[bid] = children.filter((c) => c.type === "bundle").map((c) => c.id);
  }
  for (const v of payload.fixed_values) {
    graph[(v as { id: string }).id] = [];
  }
  for (const v of payload.combines) {
    graph[(v as { id: string }).id] = [];
  }
  for (const v of payload.derivations) {
    graph[(v as { id: string }).id] = [];
  }
  for (const v of payload.categories) {
    graph[(v as { id: string }).id] = [];
  }
  for (const c of payload.constraints) {
    const cid = (c as { id: string }).id;
    // Constraint source/target ids live under `payload` per the
    // `engine.modules.constraint` schema (see constraint_handler.py:126).
    const cp = (c as { payload?: { source_wildcard_id?: string; target_wildcard_id?: string } }).payload;
    const src = cp?.source_wildcard_id;
    const tgt = cp?.target_wildcard_id;
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
    const cid = (c as { id: string }).id;
    const cp = (c as { payload?: { source_wildcard_id?: string; target_wildcard_id?: string } }).payload;
    const src = cp?.source_wildcard_id;
    const tgt = cp?.target_wildcard_id;
    if (src && tgt && selection.has(src) && selection.has(tgt)) matches.push(cid);
  }
  return matches;
}
