import { parseWidgetJson, type ContextWidgetValue } from "../widgets/_shared";

// ── Subgraph boundary primer ────────────────────────────────────────────
// ComfyUI subgraphs are nested LGraph instances attached to a parent node
// via `node.subgraph`. They have boundary proxy nodes:
//   - SubgraphInputNode  (id = -10) — sits inside the subgraph; inner nodes
//     wire INPUTs from it. Each slot maps by name to the parent SubgraphNode's
//     external input slot.
//   - SubgraphOutputNode (id = -20) — sits inside the subgraph; inner nodes
//     wire OUTPUTs into it. Each slot maps by name to the parent SubgraphNode's
//     external output slot.
//   - The IO nodes are NOT in `subgraph._nodes` — only on `subgraph.inputNode`
//     / `subgraph.outputNode`. Inner links can still reference them by id.
// To traverse the PIPELINE_CONTEXT chain across boundaries we transparently
// "step in" through SubgraphOutputNode and "step out" through SubgraphInputNode.

const SUBGRAPH_INPUT_NODE_ID = -10;
const SUBGRAPH_OUTPUT_NODE_ID = -20;
const BOUNDARY_RECURSION_LIMIT = 32;

export interface LiteLink {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
}

export interface SubgraphIOSlot {
  name: string;
  type?: string;
  /** Inner-graph link ids touching this slot. */
  linkIds?: number[];
}

export interface SubgraphIONode {
  id: number;
  slots: SubgraphIOSlot[];
}

export interface LiteNodeLike {
  id: number;
  type: string;
  inputs?: { name: string; link: number | null; type?: string }[];
  outputs?: { name: string; links?: number[] | null; type?: string }[];
  widgets?: { name: string; value: unknown }[];
  /** Inner LGraph for SubgraphNodes. Mirrors `node.subgraph` from litegraph. */
  subgraph?: LiteGraphLike;
  /** Litegraph SubgraphNode marker. Also detected via `subgraph != null`. */
  isSubgraphNode?(): boolean;
  /** Containing LGraph — set by litegraph on every node that's been added. */
  graph?: LiteGraphLike;
}

/**
 * Litegraph LGraph surface we touch. Both root and subgraph instances satisfy
 * this. `id` is undefined on the root graph and a UUID on subgraphs.
 */
export interface LiteGraphLike {
  id?: string;
  _nodes: LiteNodeLike[];
  /** In current litegraph this is a Proxy over a Map; bracket access works. */
  links: Record<number, LiteLink>;
  getNodeById(id: number): LiteNodeLike | null;
  /** Boundary IO nodes — only populated on subgraph LGraphs. */
  inputNode?: SubgraphIONode;
  outputNode?: SubgraphIONode;
}

function widgetValue(node: LiteNodeLike, name: string): string {
  const w = node.widgets?.find((x) => x.name === name);
  return typeof w?.value === "string" ? w.value : "";
}

function moduleWrites(node: LiteNodeLike): string[] {
  const v = parseWidgetJson<ContextWidgetValue>(widgetValue(node, "modules"), { version: 1, modules: [] });
  const out: string[] = [];
  for (const m of v.modules) {
    if (!m.enabled) continue;
    for (const e of m.entries) {
      const name = e.variable_name.replace(/^\$/, "").trim();
      if (name) out.push(name);
    }
  }
  return out;
}

function isSubgraphNode(n: LiteNodeLike): boolean {
  if (typeof n.isSubgraphNode === "function") {
    try { return n.isSubgraphNode() === true; } catch { /* fall through */ }
  }
  return n.subgraph != null;
}

/** Containing LGraph — falls back to passed graph when litegraph hasn't set it. */
function graphOf(node: LiteNodeLike, fallback: LiteGraphLike): LiteGraphLike {
  return node.graph ?? fallback;
}

type SubgraphParent = { node: LiteNodeLike; graph: LiteGraphLike };

/**
 * Walk root → leaves once and record each subgraph's parent SubgraphNode +
 * the LGraph that contains it. Used to step OUT through SubgraphInputNode
 * boundaries: given a subgraph id, we know which outer node + graph to
 * resume traversal from.
 */
function buildSubgraphParents(root: LiteGraphLike): Map<string, SubgraphParent> {
  const out = new Map<string, SubgraphParent>();
  function descend(g: LiteGraphLike) {
    for (const n of g._nodes ?? []) {
      const sg = n.subgraph;
      if (sg && sg.id) {
        out.set(sg.id, { node: n, graph: g });
        descend(sg);
      }
    }
  }
  descend(root);
  return out;
}

interface BoundaryStep {
  graph: LiteGraphLike;
  node: LiteNodeLike;
  /** Output slot index on `node` we just arrived through. */
  originSlot: number;
}

/**
 * Step INTO a SubgraphNode: given the outer SubgraphNode and the output slot
 * we're walking against, find the inner producer feeding that output via the
 * SubgraphOutputNode slot of the same name.
 */
function stepIntoSubgraph(subNode: LiteNodeLike, originSlot: number): BoundaryStep | null {
  const out = subNode.outputs?.[originSlot];
  const subgraph = subNode.subgraph;
  const outputNode = subgraph?.outputNode;
  if (!out || !subgraph || !outputNode) return null;
  // Slot names match between the outer SubgraphNode and the inner
  // SubgraphOutputNode — that's how litegraph routes the boundary.
  const slot = outputNode.slots.find((s) => s.name === out.name);
  if (!slot || !slot.linkIds?.length) return null;
  // Take the first wired inner link. PIPELINE_CONTEXT is a single-source
  // chain so multi-write at this boundary would be a graph error anyway.
  const link = subgraph.links[slot.linkIds[0]];
  if (!link) return null;
  const inner = subgraph.getNodeById(link.origin_id);
  if (!inner) return null;
  return { graph: subgraph, node: inner, originSlot: link.origin_slot };
}

/**
 * Step OUT through a SubgraphInputNode: given the inner LGraph and the
 * input-slot index on its inputNode that the link arrived from, resolve the
 * matching named input on the parent SubgraphNode and follow ITS link in
 * the parent graph.
 */
function stepOutOfSubgraph(
  innerGraph: LiteGraphLike,
  inputNodeSlot: number,
  parents: Map<string, SubgraphParent>,
): BoundaryStep | null {
  if (!innerGraph.id) return null;
  const parent = parents.get(innerGraph.id);
  const inputNode = innerGraph.inputNode;
  if (!parent || !inputNode) return null;
  const innerSlot = inputNode.slots[inputNodeSlot];
  if (!innerSlot) return null;
  // Find the parent SubgraphNode's input slot with the same name.
  const outerSlot = parent.node.inputs?.find((s) => s.name === innerSlot.name);
  if (!outerSlot || outerSlot.link == null) return null;
  const outerLink = parent.graph.links[outerSlot.link];
  if (!outerLink) return null;
  const outer = parent.graph.getNodeById(outerLink.origin_id);
  if (!outer) return null;
  return { graph: parent.graph, node: outer, originSlot: outerLink.origin_slot };
}

/**
 * Resolve a (graph, node, originSlot) tuple through any number of stacked
 * subgraph boundaries until it points at a real producer (not an IO proxy
 * and not a SubgraphNode wrapper). Returns null if any hop fails.
 */
function resolveThroughBoundaries(
  start: BoundaryStep,
  parents: Map<string, SubgraphParent>,
): BoundaryStep | null {
  let cur: BoundaryStep | null = start;
  for (let i = 0; cur && i < BOUNDARY_RECURSION_LIMIT; i++) {
    if (cur.node.id === SUBGRAPH_INPUT_NODE_ID) {
      cur = stepOutOfSubgraph(cur.graph, cur.originSlot, parents);
      continue;
    }
    if (isSubgraphNode(cur.node)) {
      cur = stepIntoSubgraph(cur.node, cur.originSlot);
      continue;
    }
    return cur;
  }
  return null;
}

/**
 * Find the upstream PIPELINE_CONTEXT producer for `node`, transparently
 * stepping through subgraph boundaries. Returns the node WITH its containing
 * graph since the chain can leave the starting subgraph.
 */
function pipelineUpstreamOf(
  node: LiteNodeLike,
  graph: LiteGraphLike,
  parents: Map<string, SubgraphParent>,
): { graph: LiteGraphLike; node: LiteNodeLike } | null {
  for (const slot of node.inputs ?? []) {
    if (slot.link == null) continue;
    const link = graph.links[slot.link];
    if (!link) continue;

    let step: BoundaryStep | null;
    if (link.origin_id === SUBGRAPH_INPUT_NODE_ID) {
      // Boundary at this very link — step OUT before we can even read origin.
      step = stepOutOfSubgraph(graph, link.origin_slot, parents);
    } else {
      const origin = graph.getNodeById(link.origin_id);
      if (!origin) continue;
      step = { graph, node: origin, originSlot: link.origin_slot };
    }

    const resolved = step ? resolveThroughBoundaries(step, parents) : null;
    if (!resolved) continue;

    // Confirm we landed on a PIPELINE_CONTEXT producer slot.
    const out = resolved.node.outputs?.[resolved.originSlot];
    if (out?.type === "PIPELINE_CONTEXT") return { graph: resolved.graph, node: resolved.node };
  }
  return null;
}

/**
 * Walk upstream from `node` collecting variable names written by every
 * upstream WP_Context. Does NOT include the starting node's own writes — the
 * caller (a Context widget rendering its own conflict UI) wants to know what
 * is coming IN from upstream so it can compare against its own writes.
 *
 * Crosses subgraph boundaries transparently: if the upstream Context lives
 * outside a subgraph the starting node is in, we step OUT through the
 * SubgraphInputNode proxy; if the upstream chain crosses INTO a subgraph,
 * we step IN through the SubgraphOutputNode proxy.
 *
 * `rootGraph` should be `app.graph` (top-level). The starting node may live
 * anywhere in the nested graph tree.
 */
export function collectUpstreamVariables(rootGraph: LiteGraphLike, node: LiteNodeLike): string[] {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const vars = new Set<string>();
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    if (cur.node.type === "WP_Context") moduleWrites(cur.node).forEach((v) => vars.add(v));
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  return Array.from(vars);
}

/**
 * Walk upstream collecting (variable → value) pairs. Last-write-wins matches
 * runtime semantics: chain order is upstream-first → downstream-last; we
 * reverse the walk so downstream values override upstream ones in the map.
 *
 * Crosses subgraph boundaries identically to `collectUpstreamVariables`.
 */
export function collectUpstreamValues(rootGraph: LiteGraphLike, node: LiteNodeLike): Record<string, string> {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  const out: Record<string, string> = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (n.type !== "WP_Context") continue;
    const v = parseWidgetJson<ContextWidgetValue>(widgetValue(n, "modules"), { version: 1, modules: [] });
    for (const m of v.modules) {
      if (!m.enabled) continue;
      for (const e of m.entries) {
        const name = e.variable_name.replace(/^\$/, "").trim();
        if (!name) continue;
        out[name] = e.value;
      }
    }
  }
  return out;
}

/**
 * Locator — node ids are unique only within a single LGraph; nested
 * subgraphs reuse the same id space. Pair `(graph.id, node.id)` to dedupe
 * across the whole nested tree.
 */
function locator(graph: LiteGraphLike, node: LiteNodeLike): string {
  return `${graph.id ?? "root"}:${node.id}`;
}

/**
 * BFS downstream from `node` along PIPELINE_CONTEXT edges, returning every
 * WP_PromptAssembler in reach. Walks through subgraph boundaries: a
 * SubgraphNode in the chain is unwrapped by following its inputNode slot
 * inside; an outgoing link to the SubgraphOutputNode (target_id === -20)
 * resumes from the parent SubgraphNode's matching named output in the
 * parent graph.
 */
export function findDownstreamAssemblers(rootGraph: LiteGraphLike, node: LiteNodeLike): LiteNodeLike[] {
  const parents = buildSubgraphParents(rootGraph);
  const out: LiteNodeLike[] = [];
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const queue: { graph: LiteGraphLike; node: LiteNodeLike }[] = [
    { graph: graphOf(node, rootGraph), node },
  ];

  while (queue.length) {
    const cur = queue.shift();
    if (!cur) break;
    for (const o of cur.node.outputs ?? []) {
      if (o.type !== "PIPELINE_CONTEXT") continue;
      for (const linkId of o.links ?? []) {
        const link = cur.graph.links[linkId];
        if (!link) continue;
        const stepped = downstreamStep(cur.graph, link, parents);
        if (!stepped) continue;
        const key = locator(stepped.graph, stepped.node);
        if (seen.has(key)) continue;
        seen.add(key);
        if (stepped.node.type === "WP_PromptAssembler") out.push(stepped.node);
        else queue.push({ graph: stepped.graph, node: stepped.node });
      }
    }
  }
  return out;
}

/**
 * Resolve a downstream link target through any subgraph boundaries:
 *   - target_id === -20: link enters the SubgraphOutputNode → resume from
 *     the parent SubgraphNode's matching output in the parent graph.
 *   - target is a SubgraphNode: link enters via SubgraphInputNode proxy →
 *     fan out to each inner consumer (we pick the first; downstream walk
 *     recurses anyway via the BFS queue).
 */
function downstreamStep(
  graph: LiteGraphLike,
  link: LiteLink,
  parents: Map<string, SubgraphParent>,
): { graph: LiteGraphLike; node: LiteNodeLike } | null {
  if (link.target_id === SUBGRAPH_OUTPUT_NODE_ID) {
    // Find which output of the parent SubgraphNode this proxies, then resume.
    const innerSlot = graph.outputNode?.slots[link.target_slot];
    if (!innerSlot || !graph.id) return null;
    const parent = parents.get(graph.id);
    if (!parent) return null;
    return { graph: parent.graph, node: parent.node };
  }
  const target = graph.getNodeById(link.target_id);
  if (!target) return null;
  if (isSubgraphNode(target)) {
    // Step into subgraph — find SubgraphInputNode slot matching the input
    // slot's name and follow its first inner link.
    const targetInputName = target.inputs?.[link.target_slot]?.name;
    const inputNode = target.subgraph?.inputNode;
    if (!targetInputName || !target.subgraph || !inputNode) return null;
    const slot = inputNode.slots.find((s) => s.name === targetInputName);
    if (!slot || !slot.linkIds?.length) return null;
    const innerLink = target.subgraph.links[slot.linkIds[0]];
    if (!innerLink) return null;
    const inner = target.subgraph.getNodeById(innerLink.target_id);
    if (!inner) return null;
    return { graph: target.subgraph, node: inner };
  }
  return { graph, node: target };
}

/**
 * Yield every node in `rootGraph` and any nested subgraph, paired with the
 * LGraph that contains it. Use for graph-wide scans (e.g. pre-run
 * validation finding every WP_PromptAssembler regardless of nesting depth).
 */
export function* walkAllNodes(
  rootGraph: LiteGraphLike,
): Generator<{ graph: LiteGraphLike; node: LiteNodeLike }> {
  const stack: LiteGraphLike[] = [rootGraph];
  while (stack.length) {
    const g = stack.pop();
    if (!g) break;
    for (const n of g._nodes ?? []) {
      yield { graph: g, node: n };
      if (n.subgraph) stack.push(n.subgraph);
    }
  }
}
