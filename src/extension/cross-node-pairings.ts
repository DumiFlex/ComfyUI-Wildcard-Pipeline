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
import { assignCodenames, baseCodename } from "./node-codename";

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
  // Widget was renamed to `wp_modules` during the `wp_`-prefix sweep
  // (CLAUDE.md "Custom widget types"). Reading the legacy name returns
  // undefined, the walker sees zero modules, computePairings returns
  // an empty map, and every PairBadge `v-if` skips → no badges anywhere
  // even when the constraint + target wildcard are both present. Keep
  // this in sync with the schema literal in `wp_nodes/context_node.py`.
  const raw = widgetValue(node, "wp_modules");
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

/** Effective payload for the badge layer: the library `m.payload` with the
 *  per-instance `target_select` override folded in when present. SP3 reach
 *  edits in the editor modal write to `instance.target_select` (the default
 *  `all` collapsed to `null`), but `computePairingsFull` reads
 *  `payload.target_select`. Without folding the override here, an
 *  instance-level reach change never reaches the canvas badge — it keeps
 *  showing the library reach (`all`). Precedence mirrors
 *  `ConstraintInstanceModal.targetSelect`: a non-null instance override wins;
 *  `null`/absent inherits the library payload value. Only constraints carry
 *  `target_select`; for every other module the spread is a harmless copy. */
function effectiveChainPayload(m: ModuleEntry): Record<string, unknown> {
  const base = (m.payload ?? {}) as Record<string, unknown>;
  const override = m.instance?.target_select;
  if (override === undefined || override === null) return base;
  return { ...base, target_select: override };
}

/**
 * Flatten the upstream + own + downstream Context chain into a single
 * `ChainModule[]` ready for `computePairings`. Each entry carries a
 * graph-wide-unique `rowKey` so pairings work across duplicate library
 * instances + across Context-node boundaries.
 *
 * Every flattened module is tagged with `nodeLabel` — its source Context
 * node's CODENAME (`assignCodenames`): a fixed `adjective-noun` derived from
 * the litegraph node id. Unlike the pre-2026 walk-position letters, a
 * codename is POV-independent (the same node reads the same name from any
 * viewer — the old letters shifted by viewer + by empty upstream nodes, so
 * two chain heads both showed "A") and unique on the canvas. Cross-node UI
 * reads this to name WHICH node a target instance lives in.
 */
export function collectFullChainModules(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): ChainModule[] {
  const out: ChainModule[] = [];

  // Re-walk the upstream Context nodes locally so we have their node refs —
  // collectUpstreamChain returns modules without their owning node.
  const upstreamMods = collectUpstreamChain(rootGraph, node) as ModuleEntry[][];
  const upstreamNodes = upstreamContextNodes(rootGraph, node);
  const downstreamNodes = collectDownstreamContextNodes(rootGraph, node);

  // Assign a fixed, unique codename to every Context node in the chain,
  // keyed by litegraph node id. POV-independent — `assignCodenames` sorts
  // by id internally, so a node reads the same name regardless of which
  // node we walked from. `labelOf` falls back to the bare base codename for
  // any node the assignment somehow missed (defensive; shouldn't happen).
  const codenames = assignCodenames([
    ...upstreamNodes.map((n) => n.id),
    node.id,
    ...downstreamNodes.map((n) => n.id),
  ]);
  const labelOf = (n: LiteNodeLike): string =>
    codenames.get(String(n.id)) ?? baseCodename(n.id);
  for (let i = 0; i < Math.min(upstreamMods.length, upstreamNodes.length); i++) {
    const upNode = upstreamNodes[i];
    const nodeLabel = labelOf(upNode);
    for (const m of upstreamMods[i]) {
      out.push({
        id: m.id,
        rowKey: rowKey(upNode.id, m),
        type: m.type,
        payload: effectiveChainPayload(m),
        displayName: m.meta?.name,
        nodeLabel,
      });
    }
  }

  // Own node's modules.
  const ownLabel = labelOf(node);
  for (const m of extractModules(node)) {
    out.push({
      id: m.id,
      rowKey: rowKey(node.id, m),
      type: m.type,
      payload: effectiveChainPayload(m),
      displayName: m.meta?.name,
      nodeLabel: ownLabel,
    });
  }

  // Downstream chain.
  for (const dn of downstreamNodes) {
    const nodeLabel = labelOf(dn);
    for (const m of extractModules(dn)) {
      out.push({
        id: m.id,
        rowKey: rowKey(dn.id, m),
        type: m.type,
        payload: effectiveChainPayload(m),
        displayName: m.meta?.name,
        nodeLabel,
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
