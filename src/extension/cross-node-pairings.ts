/**
 * Cross-node pairing badge computation.
 *
 * Constraints can claim target wildcard instances anywhere downstream
 * in the runtime execution chain — not just within the same WP_Context
 * node. This composer walks the upstream chain + own Context + the
 * downstream Context chain, flattens every module into a single
 * execution-order array, and runs `computePairings` once on the result.
 *
 * Row keys are composed as `${nodeId}#${_uid}` so duplicate library
 * instances (which share a module `id`) get distinct map keys, and
 * modules in different Context nodes never collide.
 *
 * Caller is `src/widgets/context.ts` — wires this into a
 * `reactiveFromGraph` poll so the badges refresh on chain mutations,
 * exactly the same way the conflict scanner stays current.
 */

import {
  collectUpstreamChain,
  collectDownstreamContextNodes,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";
import {
  parseWidgetJson,
  type ContextWidgetValue,
  type ModuleEntry,
} from "../widgets/_shared";
import {
  computePairings,
  computePairingsFull,
  type ChainModule,
  type PairingBadge,
  type RowPairings,
} from "./constraint-pairs";

/** Compose a globally-unique row key. Module `_uid` is per-Context-node
 *  unique; prefixing with the litegraph node id makes it graph-wide
 *  unique so cross-node lookups don't collide. */
export function rowKey(nodeId: number | string, m: ModuleEntry): string {
  return `${nodeId}#${m._uid ?? m.id}`;
}

function widgetValue(node: LiteNodeLike, name: string): unknown {
  // Litegraph stores widget state on the node; the name match matches
  // ContextWidget's exported widget name. Mirror the helper in graph.ts.
  const widgets = (node as { widgets?: { name: string; value: unknown }[] }).widgets ?? [];
  const w = widgets.find((x) => x.name === name);
  return w?.value;
}

function extractModules(node: LiteNodeLike): ModuleEntry[] {
  const raw = widgetValue(node, "modules");
  const v = parseWidgetJson<ContextWidgetValue>(
    typeof raw === "string" ? raw : "",
    { version: 1, modules: [] },
  );
  // Pairings account for disabled modules positionally — the runtime
  // engine doesn't claim disabled targets, but the badge still helps
  // the user see WHY their disabled chain misbehaves. Keep all modules
  // in the chain regardless of `enabled` / bundle gate.
  return v.modules;
}

/**
 * Flatten the upstream + own + downstream Context chain into a single
 * `ChainModule[]` ready for `computePairings`. Each entry carries a
 * graph-wide-unique `rowKey` so pairings work across duplicate library
 * instances + across Context-node boundaries.
 */
export function collectFullChainModules(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): ChainModule[] {
  const out: ChainModule[] = [];

  // Upstream chain — already returns ContextWidgetValue.modules arrays
  // upstream-first. We need the matching node ids for rowKey, but the
  // existing helper returns just modules. Re-walk locally to get the
  // node + modules pairs in the same order.
  // (collectUpstreamChain returns modules without nodeId; cheaper to
  // re-walk than re-tag.)
  const upstreamMods = collectUpstreamChain(rootGraph, node) as ModuleEntry[][];
  const upstreamNodes = upstreamContextNodes(rootGraph, node);
  for (let i = 0; i < Math.min(upstreamMods.length, upstreamNodes.length); i++) {
    const nId = upstreamNodes[i].id;
    for (const m of upstreamMods[i]) {
      out.push({
        id: m.id,
        rowKey: rowKey(nId, m),
        type: m.type,
        payload: (m.payload ?? {}) as Record<string, unknown>,
        displayName: m.meta?.name,
      });
    }
  }

  // Own node's modules.
  for (const m of extractModules(node)) {
    out.push({
      id: m.id,
      rowKey: rowKey(node.id, m),
      type: m.type,
      payload: (m.payload ?? {}) as Record<string, unknown>,
      displayName: m.meta?.name,
    });
  }

  // Downstream chain.
  for (const dn of collectDownstreamContextNodes(rootGraph, node)) {
    for (const m of extractModules(dn)) {
      out.push({
        id: m.id,
        rowKey: rowKey(dn.id, m),
        type: m.type,
        payload: (m.payload ?? {}) as Record<string, unknown>,
        displayName: m.meta?.name,
      });
    }
  }

  return out;
}

/** Walk upstream like `collectUpstreamChain` but return the node refs
 *  so we can prefix rowKeys with each node's id. Mirrors the helper's
 *  internal walk; kept private to this module to avoid changing the
 *  public signature of `collectUpstreamChain`. */
function upstreamContextNodes(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): LiteNodeLike[] {
  // Local re-implementation: collectUpstreamChain itself is private
  // about its node list. Re-walk via the same `pipelineUpstreamOf`
  // helper. To avoid duplicating that helper's import surface, do a
  // lightweight equivalent: walk inputs[0].link → origin_id repeatedly
  // until we leave the chain. This covers the no-subgraph case; for
  // subgraph-boundary upstream we accept the limitation that
  // boundary-traversing duplicate rowKeys could collide in pathological
  // graphs (a separate refactor exposing pipelineUpstreamOf would fix
  // it; deferred until that's actually needed).
  const out: LiteNodeLike[] = [];
  const seen = new Set<number>([node.id]);
  // Walk via Litegraph link metadata. The legacy callers all use
  // node.inputs[i].link → graph.links[link].origin_id, so this matches
  // the runtime path the engine actually uses (and matches collectUpstreamChain
  // when no subgraph boundaries are present).
  let cur: LiteNodeLike | null = node;
  while (cur) {
    const inputLink = (cur.inputs ?? []).find((i) => i.type === "PIPELINE_CONTEXT");
    const linkId = inputLink?.link;
    if (linkId === undefined || linkId === null) break;
    const link = rootGraph.links[linkId];
    if (!link) break;
    const origin = rootGraph.getNodeById(link.origin_id);
    if (!origin) break;
    if (seen.has(origin.id)) break;
    seen.add(origin.id);
    if (origin.type === "WP_Context") out.unshift(origin);  // upstream-first
    cur = origin;
  }
  return out;
}

/** One-shot composer for `widgets/context.ts`: returns the full
 *  cross-node pairings Map keyed by `rowKey(nodeId, _uid)`. */
export function collectCrossNodePairings(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): Map<string, PairingBadge> {
  return computePairings(collectFullChainModules(rootGraph, node));
}

/** Rich-shape variant — returns per-row `{ direct, viaInbound[] }` so
 *  consumers can render both the legacy direct chip AND the new
 *  collapsed `↪×N` carrier chip. Same input as `collectCrossNodePairings`;
 *  the legacy map is derivable from this via the type's `direct`
 *  field, so callers needing both can compute once + pass through. */
export function collectCrossNodePairingsFull(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): Map<string, RowPairings> {
  return computePairingsFull(collectFullChainModules(rootGraph, node));
}
