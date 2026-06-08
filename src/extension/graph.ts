import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJson,
  type ContextWidgetValue,
} from "../widgets/_shared";
import { applyVarAccessor, type ResolvedValue } from "../widgets/richTokenize";
// probability.ts is a pure (no-Vue) module despite its path — reused here so
// the static multi-pick representative mirrors the engine pool exactly.
import {
  isEnabled,
  type InstanceLike,
  type WildcardOption,
} from "../components/context/editors/wildcard/probability";
import { ensure as ensurePreviewLookup, lookup as previewLookup } from "./preview-resolver";

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
  /** Litegraph execution mode. 0 = ALWAYS (default), 1 = ON_EVENT,
   *  2 = NEVER (mute), 3 = ON_TRIGGER, 4 = BYPASS. Modes 2/3/4 skip
   *  the node at runtime; the walker mirrors that by ignoring their
   *  module contributions when building the upstream-vars set. */
  mode?: number;
}

/** Modes that mean "this node does not contribute its module bindings
 *  at runtime" — `NEVER` (mute) and `BYPASS`. ON_TRIGGER (3) is
 *  technically also non-default but unused for WP_Context in practice;
 *  skip-list is intentionally narrow. */
const SKIP_MODES = new Set<number>([2, 4]);
function isSkippedMode(node: LiteNodeLike): boolean {
  return typeof node.mode === "number" && SKIP_MODES.has(node.mode);
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

/**
 * Derive the root LGraph from any starting graph, climbing the subgraph
 * parent chain until we hit a graph with no `id` (litegraph marks the
 * root LGraph with `id === undefined` and assigns UUIDs to every nested
 * subgraph). Falls back to the input graph if the chain can't be
 * resolved — in practice this means a graph that is NOT root but also
 * has no parent reachable via the litegraph hooks; downstream walkers
 * still operate on it but `buildSubgraphParents` won't see siblings
 * outside the starting view.
 *
 * Why this exists: `app.graph` in ComfyUI is the *currently visible*
 * graph, which can become a subgraph when the user double-clicks into
 * one. A WP_Context inside the root will then be walked against a
 * subgraph reference, `getNodeById(upstreamId)` returns null because
 * upstream lives in the actual root, and the walker reports an empty
 * upstream-vars list — the symptom QA reported as the cross-node
 * missing-var false positive. Climbing from the node's containing
 * graph dodges that misalignment.
 */
export function findRootGraph(start: LiteGraphLike): LiteGraphLike {
  let cur: LiteGraphLike | null = start;
  // Litegraph SubgraphLGraph instances expose `_subgraph_node` pointing
  // at the wrapping SubgraphNode in the parent graph. Climbing through
  // it gives us the parent LGraph; loop until we land on a graph with
  // no id (= root). Hard cap at BOUNDARY_RECURSION_LIMIT to fail safe
  // if the chain is somehow circular.
  for (let i = 0; cur && i < BOUNDARY_RECURSION_LIMIT; i++) {
    if (cur.id === undefined) return cur;
    const wrapped = cur as unknown as { _subgraph_node?: LiteNodeLike };
    const parentNode: LiteNodeLike | undefined = wrapped._subgraph_node;
    const parentGraph: LiteGraphLike | undefined = parentNode?.graph;
    if (!parentGraph) return cur;
    cur = parentGraph;
  }
  return start;
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
 * Walk upstream from `node` and return the unified `(name → value)`
 * map of every variable an upstream WP_Context would produce at run
 * time, with values resolved deterministically (always picks option
 * `[0]` for wildcards, applies `$var` / `@{uuid}` substitution
 * against the evolving ctx). The assembler preview consumes this
 * directly — there are no longer two parallel "names list" /
 * "values map" tracks.
 *
 * Determinism note: this is "preview-grade" resolution. Real graph
 * runs use a random-seeded RNG; the preview does not (so users can
 * type into the assembler template and see stable output as they
 * work). Constraints, derivations and pipelines are not simulated;
 * see `resolveChainStatic` for the per-kind handling.
 *
 * Crosses subgraph boundaries transparently: if the upstream
 * Context lives outside a subgraph the starting node is in, we step
 * OUT through the SubgraphInputNode proxy; if the upstream chain
 * crosses INTO a subgraph, we step IN through the SubgraphOutputNode
 * proxy. `rootGraph` should be `app.graph` (top-level). The starting
 * node may live anywhere in the nested graph tree.
 */
export function collectUpstreamResolved(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): Record<string, ResolvedValue> {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  return resolveChainStatic(chain);
}

/**
 * Resolved-var snapshot from the perspective of a SPECIFIC module
 * inside `node`. Includes:
 *   - everything `collectUpstreamResolved(rootGraph, node)` returns
 *     (chain modules upstream of `node`)
 *   - bindings produced by other modules in `node` itself, simulated
 *     in array order (last-write-wins matches engine pipeline)
 *   - excludes the module whose id matches `excludeModuleId`, so the
 *     module being edited doesn't read its own (about-to-be-written)
 *     binding back into its template preview.
 *
 * Drives the combine modal's live-preview pane: a combine can
 * reference any var produced upstream OR by an earlier sibling in the
 * same Context node. Static preview must reflect both. The chain
 * walker alone (`collectUpstreamResolved`) misses sibling bindings
 * because it stops at `node` — fine for the assembler downstream of
 * `node` (which only sees the public socket payload), wrong for a
 * module IN `node` reaching across to a sibling.
 */
export function collectLocalResolvedForModule(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
  excludeModuleId?: string,
): Record<string, ResolvedValue> {
  // Step 1: pull upstream-only resolution as the base ctx.
  const ctx = collectUpstreamResolved(rootGraph, node);

  // Step 2: walk this node's own modules in declaration order so
  // earlier siblings write before later ones. Excluded module is
  // skipped — this is the module being edited; reading its own
  // about-to-be-emitted binding would surface stale state.
  if (isSkippedMode(node)) return ctx;

  const v = parseWidgetJson<ContextWidgetValue>(
    widgetValue(node, "wp_modules"),
    { version: 1, modules: [] },
  );

  // Build a wildcard catalog over THIS node so refs in option values
  // (`@{uuid}`) resolve when wildcard siblings get simulated. Mirrors
  // `resolveChainStatic`'s catalog construction. Cross-node refs are
  // already in `ctx` from the upstream walk, but local catalog
  // entries need to be discoverable by `expandValue` here.
  const catalog = new Map<string, MinimalWildcard>();
  for (const m of v.modules) {
    if (m.type !== "wildcard" || !m.payload) continue;
    catalog.set(m.id, m.payload as MinimalWildcard);
  }

  const bundleEnabled = buildBundleEnabledMap(v.bundles);
  for (const m of v.modules) {
    if (excludeModuleId && m.id === excludeModuleId) continue;
    if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
    writeBindings(ctx, m, catalog);
  }

  return ctx;
}

/**
 * Variable names known upstream of `node`. Thin alias over
 * {@link collectUpstreamResolved} for call sites (subgraph badge,
 * autocompletes) that only need the keys.
 */
export function collectUpstreamVariables(rootGraph: LiteGraphLike, node: LiteNodeLike): string[] {
  return Object.keys(collectUpstreamResolved(rootGraph, node))
    .filter((k) => !k.startsWith("__"));
}

/**
 * Walk upstream from `node` and return true iff some WP_ContextLoop in
 * the pipeline-context chain has `override_seed=true` in its widget
 * config. Used by WP_Context's widget glue to grey out the local `seed`
 * stock widget — when a Loop upstream is overriding seeds, the local
 * widget's value is unused at runtime so editing it would mislead.
 *
 * Walker uses the same `pipelineUpstreamOf` chain as the var / uuid
 * walkers so subgraph boundaries are crossed transparently. Stops at
 * the first upstream Loop (Loop has no PIPELINE_CONTEXT input so the
 * chain naturally terminates there) — a downstream Loop wouldn't drive
 * this node's seed, so we never look in that direction.
 */
export function hasUpstreamLoopOverridingSeed(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): boolean {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    if (cur.node.type === "WP_ContextLoop" && !isSkippedMode(cur.node)) {
      // Loop's widget config carries the override toggle. Mute / bypass
      // skips the Loop entirely so its override shouldn't apply.
      const raw = widgetValue(cur.node, "wp_context_loop_config");
      const cfg = parseWidgetJson<{ override_seed?: boolean }>(raw, {});
      return cfg.override_seed === true;
    }
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  return false;
}

/**
 * Variable bindings contributed by every `WP_ContextInjector` upstream
 * of `node`. Used by the assembler so the in-template preview shows
 * the injector's `$binding` placeholder for keys an injector
 * overwrites at runtime — otherwise apiResolved (which only knows
 * WP_Context modules) would surface the SHADOWED upstream value.
 */
export function collectUpstreamInjectorBindings(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): string[] {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  const out = new Set<string>();
  for (const n of chain) {
    if (n.type !== "WP_ContextInjector") continue;
    if (isSkippedMode(n)) continue;
    const inj = parseWidgetJson<{
      version: 1;
      rows?: Array<{ binding?: string; enabled?: boolean }>;
    }>(widgetValue(n, "wp_rows"), { version: 1, rows: [] });
    for (const row of inj.rows ?? []) {
      if (row.enabled !== true) continue;
      const binding = (row.binding ?? "").trim();
      if (binding) out.add(binding);
    }
  }
  return [...out];
}

/**
 * Walk upstream from `node` and return the set of every wildcard
 * module's uuid (8-hex `id`) reachable in the chain. Used by the
 * conflict scanner to validate constraint references — a constraint
 * targeting a wildcard whose uuid lives upstream would be applied
 * AFTER the wildcard already picked, defeating its purpose. The
 * same set + a same-node check lets the scanner emit "source
 * missing" / "target in upstream" warnings before runtime.
 *
 * Skips modules in muted/bypassed nodes (mode 2 / 4) — they don't
 * contribute at runtime, so a constraint referencing them is bound
 * to fail anyway, but the warning would mislead users who muted
 * the source intentionally during debugging. Mirroring runtime
 * keeps "fix the warning" actionable.
 */
export function collectUpstreamWildcardUuids(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): string[] {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  const uuids = new Set<string>();
  for (const n of chain) {
    if (n.type !== "WP_Context") continue;
    if (isSkippedMode(n)) continue;
    const v = parseWidgetJson<ContextWidgetValue>(
      widgetValue(n, "wp_modules"),
      { version: 1, modules: [] },
    );
    const bundleEnabled = buildBundleEnabledMap(v.bundles);
    for (const m of v.modules) {
      if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
      if (m.type === "wildcard") uuids.add(m.id);
    }
  }
  return [...uuids];
}

/**
 * Walk upstream from `node` and return the module list of every chain
 * `WP_Context`, ordered upstream-first → downstream-last. Used by the
 * assembler preview to POST the chain to `/wp/api/preview/resolve` —
 * the engine then runs each step's PipelineEngine with a stable seed
 * so the preview matches what the user gets at queue time.
 *
 * Skips non-Context nodes (boundary proxies and the assembler itself).
 * The returned arrays are the raw module dicts straight from each
 * Context's `modules` widget JSON; callers are responsible for any
 * shape normalisation.
 */
export function collectUpstreamChain(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): unknown[][] {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }
  // chain[] is downstream-first (first hop = closest upstream).
  // Reverse so step 0 is the FURTHEST upstream — engine runs each
  // step's pipeline with previous ctx as input, so order matters.
  // Mute/bypass nodes are dropped from the chain so the engine
  // preview doesn't run their modules — matching the canvas runtime,
  // which skips muted/bypassed nodes entirely.
  const upstreamFirst = [...chain].reverse();
  const out: unknown[][] = [];
  for (const n of upstreamFirst) {
    if (n.type !== "WP_Context") continue;
    if (isSkippedMode(n)) continue;
    const v = parseWidgetJson<ContextWidgetValue>(
      widgetValue(n, "wp_modules"),
      { version: 1, modules: [] },
    );
    // Apply the bundle gate before posting to `/wp/api/preview/resolve`.
    // The server runs each step as a flat module list — it doesn't see
    // bundles[] — so we mask `enabled=false` on any child whose
    // bundle is disabled before handing the chain over. Without this
    // gate, the assembler's API preview returns bindings from
    // bundle-disabled modules while the static fallback (which IS
    // gated) doesn't, and chip strip / preview disagree.
    const bundleIndex = buildBundleEnabledMap(v.bundles);
    if (bundleIndex.enabled.size === 0) {
      out.push(v.modules);
      continue;
    }
    const gated = v.modules.map((m) => {
      if (m.enabled === false) return m;
      // isModuleEffectivelyEnabled walks the parent_uid chain so a
      // disabled outer disables inner-bundle leaves too. AND with the
      // module's own enabled (which we know is true from the early
      // return above) → use directly.
      if (!isModuleEffectivelyEnabled(m, bundleIndex)) {
        return { ...m, enabled: false };
      }
      return m;
    });
    out.push(gated);
  }
  return out;
}

/** @deprecated — use {@link collectUpstreamResolved}. */
export const collectUpstreamValues = collectUpstreamResolved;

/**
 * Walk the upstream chain like {@link collectUpstreamResolved} but
 * record each binding's SOURCE MODULE KIND instead of its resolved
 * value. Used by AssemblerHelper to render a kind icon inside each
 * chip so the user reads "this var comes from a wildcard / fixed /
 * combine / derivation / injector" at a glance.
 *
 * Kinds returned: "wildcard" | "fixed_values" | "combine" |
 * "derivation" | "constraint" | "pipeline" | "injector".
 *
 * Last-write-wins: if two modules upstream both write to `$foo`, the
 * downstream-most one's kind is what the assembler sees (matches
 * runtime ctx ordering). Internal-flagged bindings are dropped on
 * the way out — same public-socket semantics
 * `collectUpstreamResolved` enforces.
 */
export function collectUpstreamKinds(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): Record<string, string> {
  const parents = buildSubgraphParents(rootGraph);
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const chain: LiteNodeLike[] = [];
  let cur = pipelineUpstreamOf(node, graphOf(node, rootGraph), parents);
  while (cur && !seen.has(locator(cur.graph, cur.node))) {
    seen.add(locator(cur.graph, cur.node));
    chain.push(cur.node);
    cur = pipelineUpstreamOf(cur.node, cur.graph, parents);
  }

  const kinds: Record<string, string> = {};
  const internalKeys = new Set<string>();
  // Walk furthest-upstream → closest, so later writes override
  // earlier ones (last-write-wins matches runtime).
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (isSkippedMode(n)) continue;
    if (n.type === "WP_ContextInjector") {
      const inj = parseWidgetJson<{
        version: 1;
        rows?: Array<{ binding?: string; enabled?: boolean; internal?: boolean }>;
      }>(widgetValue(n, "wp_rows"), { version: 1, rows: [] });
      for (const row of inj.rows ?? []) {
        if (row.enabled !== true) continue;
        const b = (row.binding ?? "").trim();
        if (!b) continue;
        kinds[b] = "injector";
        if (row.internal === true) internalKeys.add(b);
      }
      continue;
    }
    if (n.type === "WP_ContextLoop") {
      // Loop head stamps `$<iteration_var_name>` + `$<name>_total`.
      // Tag them with the `loop` kind so the assembler chip shows the
      // loop icon — mirrors the `resolveChainStatic` branch that
      // stamps their placeholder values. Per-key internal-ness comes
      // from the widget config (same globe toggles as a module).
      const raw = widgetValue(n, "wp_context_loop_config");
      const cfg = parseWidgetJson<{
        iteration_var_name?: string;
        iteration_internal?: boolean;
        total_internal?: boolean;
      }>(typeof raw === "string" ? raw : "", {});
      const baseName = (cfg.iteration_var_name ?? "iteration").trim() || "iteration";
      const totalName = `${baseName}_total`;
      kinds[baseName] = "loop";
      kinds[totalName] = "loop";
      if (cfg.iteration_internal === true) internalKeys.add(baseName);
      if (cfg.total_internal === true) internalKeys.add(totalName);
      continue;
    }
    if (n.type !== "WP_Context") continue;
    const v = parseWidgetJson<ContextWidgetValue>(
      widgetValue(n, "wp_modules"),
      { version: 1, modules: [] },
    );
    const bundleEnabled = buildBundleEnabledMap(v.bundles);
    for (const m of v.modules) {
      if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
      // Per-kind binding emission — mirrors writeBindings, recording
      // kind instead of value. fixed_values fans out per row; the
      // others emit a single $output_var / $var_binding.
      if (m.type === "fixed_values") {
        const inst = (m.instance ?? {}) as {
          values_overrides?: Array<{ id?: string; name?: string }>;
          enabled_options?: string[] | null;
        };
        const enabledFilter = Array.isArray(inst.enabled_options)
          ? new Set(inst.enabled_options)
          : null;
        const passes = (id: string | undefined): boolean =>
          enabledFilter === null || (typeof id === "string" && enabledFilter.has(id));
        const overrides = Array.isArray(inst.values_overrides) ? inst.values_overrides : null;
        if (overrides && overrides.length > 0) {
          for (const val of overrides) {
            if (!passes(val.id)) continue;
            const name = (val.name ?? "").replace(/^\$/, "").trim();
            if (name) kinds[name] = "fixed_values";
            if (name && m.instance?.internal) internalKeys.add(name);
          }
          continue;
        }
        const payload = (m.payload ?? {}) as { values?: Array<{ id?: string; name?: string }> };
        for (const val of payload.values ?? []) {
          if (!passes(val.id)) continue;
          const name = (val.name ?? "").replace(/^\$/, "").trim();
          if (name) kinds[name] = "fixed_values";
          if (name && m.instance?.internal) internalKeys.add(name);
        }
        for (const e of m.entries ?? []) {
          const name = (e.variable_name ?? "").replace(/^\$/, "").trim();
          if (name) kinds[name] = "fixed_values";
          if (name && m.instance?.internal) internalKeys.add(name);
        }
        continue;
      }
      if (m.type === "derivation") {
        // Each branch + the optional ELSE can name a target_var. We
        // don't know statically which branch will match, so emit every
        // distinct target_var the derivation can write to. That keeps
        // the assembler's pre-run "unresolved $var" scan from false-
        // flagging derivation outputs and lets the chip strip render
        // its kind icon.
        const dp = (m.payload ?? {}) as { rules?: Array<{
          branches?: Array<{ action?: { target_var?: string } }>;
          else?: { action?: { target_var?: string } };
        }> };
        for (const rule of dp.rules ?? []) {
          for (const branch of rule.branches ?? []) {
            const name = (branch.action?.target_var ?? "").replace(/^\$/, "").trim();
            if (name) kinds[name] = "derivation";
            if (name && m.instance?.internal) internalKeys.add(name);
          }
          const elseName = (rule.else?.action?.target_var ?? "").replace(/^\$/, "").trim();
          if (elseName) kinds[elseName] = "derivation";
          if (elseName && m.instance?.internal) internalKeys.add(elseName);
        }
        continue;
      }
      // wildcard / combine — single binding from var_binding /
      // output_var (instance.variable_binding wins when set).
      const inst = (m.instance ?? {}) as { variable_binding?: string | null };
      const payload = (m.payload ?? {}) as { var_binding?: string; output_var?: string };
      const raw = inst.variable_binding ?? payload.var_binding ?? payload.output_var ?? "";
      const name = raw.replace(/^\$/, "").trim();
      if (name) kinds[name] = m.type;
      if (name && m.instance?.internal) internalKeys.add(name);
    }
  }
  // Stash internal-flag map on the reserved slot (parallels
  // resolveChainStatic). Consumers that mirror the prompt-render
  // boundary (AssemblerHelper) drop these after reading the flags;
  // consumers that need the full view (conflict scanner) keep them.
  if (internalKeys.size > 0) {
    const flags: Record<string, boolean> = {};
    for (const k of internalKeys) flags[k] = true;
    kinds["__wp_internal_flags__"] = JSON.stringify(flags);
  }
  return kinds;
}

/* -------------------------------------------------------------------- *
 * Static chain resolution — builds the unified upstream-vars map
 * consumed by `collectUpstreamResolved`. Per-kind handling:
 *
 *   - `fixed_values` → literal `entries[].value` /
 *                      `payload.values[].value`.
 *   - `wildcard`     → first option of `payload.options` with
 *                      `$var` / `@{uuid}` substitution against the
 *                      evolving ctx + a wildcard catalog built from
 *                      every chain wildcard payload. Deterministic so
 *                      the preview is stable as users type; runtime
 *                      reseeds randomly each generation.
 *   - `combine`      → `payload.template` filled against ctx so far,
 *                      bound to `payload.output_var`.
 *   - `derivation` / `constraint` / `pipeline` → not simulated.
 *     Derivations depend on per-sample state we can't reproduce in a
 *     static preview; constraints adjust weights, not bindings;
 *     pipeline modules nest other kinds whose own bindings surface
 *     above.
 *
 * Cycle / depth protection: `expandValue` caps recursion at 8 levels,
 * matching the runtime walker's `max_ref_depth`.
 * -------------------------------------------------------------------- */

// SP2a: optional `.K` list accessor (group 2) so `$mood.0` is consumed whole
// (no stranded ".0" literal) and the index drives applyVarAccessor below.
const VAR_REF_RE = /\$([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?/g;
const WC_REF_RE = /@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g;
const MAX_REF_DEPTH = 8;

interface MinimalWildcard {
  options?: Array<{ value?: string; weight?: number }>;
  var_binding?: string;
}

function resolveChainStatic(chain: LiteNodeLike[]): Record<string, ResolvedValue> {
  // First pass: collect every wildcard payload across the whole chain
  // into one `id → payload` catalog so `@{}` refs inside option values
  // can resolve to picked-but-not-yet-walked siblings as well as
  // upstream cousins.
  const catalog = new Map<string, MinimalWildcard>();
  for (const n of chain) {
    if (n.type !== "WP_Context") continue;
    const v = parseWidgetJson<ContextWidgetValue>(
      widgetValue(n, "wp_modules"),
      { version: 1, modules: [] },
    );
    for (const m of v.modules) {
      if (m.type !== "wildcard" || !m.payload) continue;
      catalog.set(m.id, m.payload as MinimalWildcard);
    }
  }

  // Track keys produced by internal-flagged modules. Kept as an
  // out-param attribute on the returned ctx (`__wp_internal_flags__`)
  // so consumers that need to apply prompt-render filtering can do
  // so themselves. Engine fix landed in commit a345bd4: internal vars
  // now propagate across PIPELINE_CONTEXT sockets so downstream
  // Combine / Derivation modules can compose them, and only the final
  // PromptAssembler filters them at render time. Frontend walker
  // mirrors that — return everything, let each consumer (assembler
  // preview vs conflict scanner) decide whether to strip.
  const internalKeys = new Set<string>();

  // Discover `@{uuid}` refs inside chain wildcard options that aren't in
  // the chain catalog — these are nested references that the backend's
  // `embed-bundle` deliberately doesn't transitively walk. Kick off a
  // lazy fetch through preview-resolver so the *next* poll cycle can
  // expand them; this cycle falls back to the resolver's cache + name.
  const externalRefs = new Set<string>();
  for (const wc of catalog.values()) {
    for (const opt of wc.options ?? []) {
      const v = opt.value;
      if (typeof v !== "string") continue;
      for (const match of v.matchAll(/@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g)) {
        if (!catalog.has(match[1])) externalRefs.add(match[1]);
      }
    }
  }
  if (externalRefs.size) ensurePreviewLookup(externalRefs);

  // Second pass: walk chain upstream-first → downstream-last so later
  // writes override earlier ones (matches runtime last-write-wins).
  // Skip nodes whose litegraph mode is mute/bypass — at runtime
  // ComfyUI doesn't execute them, so their module bindings don't
  // appear in the chain's ctx. Static analysis must mirror that or
  // the upstream-vars set lights up references that would actually
  // be unbound at run time (and conversely, hides shadows that would
  // never fire). Bypass routes input → output topologically; the
  // walker already gets that for free because the link still points
  // at the bypassed node — we just skip its OWN contributions.
  const ctx: Record<string, ResolvedValue> = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (isSkippedMode(n)) continue;
    if (n.type === "WP_ContextInjector") {
      // Injector writes ctx[binding] = <upstream value> at runtime.
      // Static walker doesn't have the live value, so stub with the
      // binding name itself so the chip strip + upstream-vars sees
      // the binding exists. Internal-flagged rows still emit the key
      // (it's in ctx for downstream consumers) but get stripped from
      // the public map below — same path WP_Context modules use.
      const raw = widgetValue(n, "wp_rows");
      const inj = parseWidgetJson<{
        version: 1;
        rows?: Array<{
          binding?: string;
          enabled?: boolean;
          internal?: boolean;
        }>;
      }>(raw, { version: 1, rows: [] });
      const dbg = (window as unknown as { __wp_inj_walker_log__?: boolean }).__wp_inj_walker_log__;
      if (dbg) {
        // eslint-disable-next-line no-console
        console.log("[wp-inj-walker]", n.id, "raw widget value:", raw, "parsed rows:", inj.rows);
      }
      for (const row of inj.rows ?? []) {
        if (row.enabled !== true) continue;
        const binding = (row.binding ?? "").trim();
        if (!binding) continue;
        ctx[binding] = `$${binding}`;
        if (row.internal === true) internalKeys.add(binding);
      }
      continue;
    }
    if (n.type === "WP_ContextLoop") {
      // Loop stamps `$<iteration_var_name>` + `$<name>_total` into the
      // per-iteration context. Static walker doesn't know the iteration
      // index, so stub with a placeholder ("1" / count) so consumers
      // (assembler insert-var dropdown, conflict scanner) see the keys
      // exist. The runtime emits 1-based values too — keeping the
      // static placeholder aligned avoids the assembler's live-preview
      // showing "0" then a queue-time "1" jump.
      const raw = widgetValue(n, "wp_context_loop_config");
      const cfg = parseWidgetJson<{
        iteration_var_name?: string;
        iteration_internal?: boolean;
        total_internal?: boolean;
      }>(typeof raw === "string" ? raw : "", {});
      const baseName = (cfg.iteration_var_name ?? "iteration").trim() || "iteration";
      const totalName = `${baseName}_total`;
      ctx[baseName] = "1";
      ctx[totalName] = "1";
      if (cfg.iteration_internal === true) internalKeys.add(baseName);
      if (cfg.total_internal === true) internalKeys.add(totalName);
      continue;
    }
    if (n.type !== "WP_Context") continue;
    const v = parseWidgetJson<ContextWidgetValue>(
      widgetValue(n, "wp_modules"),
      { version: 1, modules: [] },
    );
    const bundleEnabled = buildBundleEnabledMap(v.bundles);
    for (const m of v.modules) {
      if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
      const beforeKeys = new Set(Object.keys(ctx));
      writeBindings(ctx, m, catalog);
      if (m.instance?.internal) {
        for (const k of Object.keys(ctx)) {
          if (!beforeKeys.has(k)) internalKeys.add(k);
        }
      }
    }
  }
  // Internal-flagged keys stay in ctx — engine now propagates them
  // across socket boundaries, so the static walker mirrors that.
  // Stash the flag map on a reserved `__wp_internal_flags__` slot so
  // any consumer that needs the prompt-render filter (assembler) can
  // call `strip_internals` to drop them, while consumers that need
  // the full view (conflict scanner, Combine preview) get every var.
  if (internalKeys.size > 0) {
    const flags: Record<string, boolean> = {};
    for (const k of internalKeys) flags[k] = true;
    ctx["__wp_internal_flags__"] = JSON.stringify(flags);
  }
  return ctx;
}

function writeBindings(
  ctx: Record<string, ResolvedValue>,
  m: ContextWidgetValue["modules"][number],
  catalog: Map<string, MinimalWildcard>,
): void {
  if (m.type === "fixed_values") {
    // Mirror `engine/modules/fixed_values_handler.py` two-tier read:
    // overrides win when present, else library payload, else the
    // widget-side `entries` mirror (covers inline-created modules
    // whose payload lives only in entries until first save).
    //
    // `instance.enabled_options` filters which row ids emit bindings
    // (engine `fixed_values_handler.py:64`). Apply the same filter
    // here so disabled rows don't appear in upstream-vars / preview.
    const inst = (m.instance ?? {}) as {
      values_overrides?: Array<{ id?: string; name?: string; value?: string }>;
      enabled_options?: string[] | null;
    };
    const enabledFilter = Array.isArray(inst.enabled_options)
      ? new Set(inst.enabled_options)
      : null;
    const passesFilter = (id: string | undefined): boolean =>
      enabledFilter === null || (typeof id === "string" && enabledFilter.has(id));

    const overrides = Array.isArray(inst.values_overrides) ? inst.values_overrides : null;
    if (overrides && overrides.length > 0) {
      for (const val of overrides) {
        if (!passesFilter(val.id)) continue;
        const name = (val.name ?? "").replace(/^\$/, "").trim();
        if (name) ctx[name] = String(val.value ?? "");
      }
      return;
    }
    // No instance-overrides → entries (UI mirror) + payload.values
    // (library) feed the ctx. `entries` lacks ids, so filter only by
    // matching variable_name back against payload.values (which has
    // the canonical ids). When entries diverge from payload, we trust
    // entries and skip the filter.
    const libValues = (m.payload as { values?: Array<{ id?: string; name?: string; value?: string }> } | undefined)?.values ?? [];
    const libNameToId = new Map<string, string>();
    for (const v of libValues) {
      if (typeof v.name === "string" && typeof v.id === "string") libNameToId.set(v.name, v.id);
    }
    for (const e of m.entries) {
      const name = e.variable_name.replace(/^\$/, "").trim();
      if (!name) continue;
      const libId = libNameToId.get(e.variable_name);
      if (!passesFilter(libId)) continue;
      ctx[name] = String(e.value ?? "");
    }
    for (const val of libValues) {
      if (!passesFilter(val.id)) continue;
      const name = (val.name ?? "").replace(/^\$/, "").trim();
      if (name) ctx[name] = String(val.value ?? "");
    }
    return;
  }
  const p = (m.payload ?? {}) as Record<string, unknown>;
  if (m.type === "wildcard") {
    const binding = (p.var_binding as string | undefined)?.replace(/^\$/, "").trim();
    const options =
      (p.options as
        | Array<{ value?: string; id?: string; sub_categories?: string[]; is_null?: boolean }>
        | undefined) ?? [];
    if (binding && options.length > 0) {
      const inst = (m.instance ?? {}) as {
        pick_min?: unknown; pick_max?: unknown; pick_separator?: unknown;
      };
      const coerce = (v: unknown, dflt: number): number => {
        if (v == null) return dflt;
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : dflt;
      };
      const lo = coerce(inst.pick_min, 1);
      const hi = Math.max(lo, coerce(inst.pick_max, lo));
      if (lo === 1 && hi === 1) {
        ctx[binding] = expandValue(String(options[0].value ?? ""), ctx, catalog, 0);
      } else {
        // SP2a multi-pick: the static resolver isn't seed-faithful (the engine
        // rolls N at random), so show a representative join of the first N
        // options. Mirror the engine POOL via isEnabled — drop the null option
        // + apply enabled_options + category_filter — so the preview never
        // leaks null (a stray leading separator) or filtered-out options. The
        // API-backed preview shows the real seeded roll.
        const pool = options.filter((o) =>
          isEnabled(o as unknown as WildcardOption, m.instance as unknown as InstanceLike, true),
        );
        const sep = typeof inst.pick_separator === "string" ? inst.pick_separator : ", ";
        const n = Math.min(hi, pool.length);
        const items: string[] = [];
        for (let i = 0; i < n; i++) {
          items.push(expandValue(String(pool[i].value ?? ""), ctx, catalog, 0));
        }
        // Bind a STRUCTURED ListVar (not a pre-joined string) so a downstream
        // `$mood.0` can index the first item — `applyVarAccessor` joins it for
        // a bare `$mood`. Pre-joining lost the per-index access.
        ctx[binding] = { items, sep };
      }
    }
    return;
  }
  if (m.type === "combine") {
    // Honor v2 instance overrides — engine reads
    // `instance.template_override` first (combine_handler.py:64) and
    // `instance.variable_binding` rebinds the output (mirroring
    // wildcard's identity section). Static preview must match so
    // downstream assemblers see the post-edit shape immediately
    // instead of waiting for a queue round-trip.
    const inst = (m.instance ?? {}) as {
      template_override?: string | null;
      variable_binding?: string | null;
    };
    const libBinding = (p.output_var as string | undefined)?.replace(/^\$/, "").trim();
    const overrideBinding = (inst.variable_binding ?? "").replace(/^\$/, "").trim();
    const out = overrideBinding || libBinding;
    const tmpl =
      typeof inst.template_override === "string" && inst.template_override !== ""
        ? inst.template_override
        : String(p.template ?? "");
    if (out) ctx[out] = expandValue(tmpl, ctx, catalog, 0);
    return;
  }
  if (m.type === "derivation") {
    // Best-effort static preview that mirrors engine/modules/
    // derivation_handler.py: each rule evaluates its branches against
    // the current static ctx in order; the first branch whose
    // condition matches fires its action; if none match, the optional
    // ELSE clause fires. Wildcard "static value = first option",
    // fixed_values literals, and the running ctx mutations from
    // earlier modules feed the condition checks, so a derivation
    // that keys off `$mood = "dramatic"` resolves correctly when
    // `$mood` is statically known. Without this, $accent etc. were
    // absent from `collectUpstreamResolved`, which made the pre-run
    // "unresolved $var" scan and the chip-strip icon path both miss
    // derivation outputs.
    const dp = (m.payload ?? {}) as { rules?: Array<{
      branches?: Array<{
        condition?: { var?: string; op?: string; value?: string };
        action?: { target_var?: string; mode?: string; value?: string };
      }>;
      else?: { action?: { target_var?: string; mode?: string; value?: string } };
    }> };
    for (const rule of dp.rules ?? []) {
      let applied = false;
      for (const branch of rule.branches ?? []) {
        if (matchDerivationCondition(branch.condition, ctx)) {
          applyDerivationAction(branch.action, ctx, catalog);
          applied = true;
          break;
        }
      }
      if (!applied && rule.else) {
        applyDerivationAction(rule.else.action, ctx, catalog);
      }
    }
    return;
  }
  // constraint / pipeline: no static binding for preview.
}

function matchDerivationCondition(
  cond: { var?: string; op?: string; value?: string } | undefined,
  ctx: Record<string, ResolvedValue>,
): boolean {
  if (!cond) return false;
  const varName = cond.var ?? "";
  const op = cond.op ?? "";
  const value = cond.value ?? "";
  // SP2a: normalise the stored value to its string form (a multi-pick var is
  // a ListVar — join it; mirrors engine derivation_handler) so the string ops
  // below never run on an object.
  const actual = applyVarAccessor(ctx[varName], undefined);
  // Presence-check ops short-circuit on key presence + non-empty value.
  if (op === "exists") return varName in ctx;
  if (op === "not_exists") return !(varName in ctx);
  if (op === "is_set") return varName in ctx && actual !== "";
  if (op === "is_unset") return !(varName in ctx) || actual === "";
  if (op === "equals") return actual === value;
  if (op === "not_equals") return actual !== value;
  if (op === "contains") return actual.includes(value);
  if (op === "matches") {
    try { return new RegExp(value).test(actual); } catch { return false; }
  }
  return false;
}

function applyDerivationAction(
  action: { target_var?: string; mode?: string; value?: string } | undefined,
  ctx: Record<string, ResolvedValue>,
  catalog: Map<string, MinimalWildcard>,
): void {
  if (!action) return;
  const target = (action.target_var ?? "").replace(/^\$/, "").trim();
  if (!target) return;
  const mode = action.mode ?? "replace";
  const raw = action.value ?? "";
  const newValue = expandValue(raw, ctx, catalog, 0);
  // SP2a: read the existing target value in string form (join a ListVar)
  // before append/prepend so we never concatenate onto "[object Object]".
  const cur = applyVarAccessor(ctx[target], undefined);
  if (mode === "replace") ctx[target] = newValue;
  else if (mode === "append") ctx[target] = cur + newValue;
  else if (mode === "prepend") ctx[target] = newValue + cur;
}

function expandValue(
  raw: string,
  ctx: Record<string, ResolvedValue>,
  catalog: Map<string, MinimalWildcard>,
  depth: number,
): string {
  if (!raw) return raw;
  if (depth > MAX_REF_DEPTH) return raw;
  // 1. Substitute `$var` (+ optional `.K` accessor) with ctx values; leave
  //    unknowns (incl. their accessor) intact. ctx values are strings in this
  //    static resolver, so applyVarAccessor treats `$s.0` as `$s` and `$s.K>0`
  //    as "" — never leaking the literal ".K" into the preview.
  let out = raw.replace(VAR_REF_RE, (full, name, idx) =>
    Object.prototype.hasOwnProperty.call(ctx, name)
      ? applyVarAccessor(ctx[name], idx != null ? parseInt(idx, 10) : undefined)
      : full,
  );
  // 2. Substitute `@{8hex}` with the referenced wildcard's first option,
  //    recursively expanded so chains (`@{a}` → "@{b} hat" → "blue hat")
  //    flatten. Resolution ladder:
  //      a. chain catalog (sibling/cousin wildcards in any chain Context)
  //      b. lazy preview-resolver cache (background-fetched from DB)
  //      c. preview-resolver name fallback → render `[name]` so users
  //         see something meaningful even before the fetch resolves
  //         a `firstOption`, or for non-wildcard kinds that have no
  //         option to expand
  //      d. raw `@{uuid}` placeholder (last resort — will resolve to
  //         the real value at runtime via the live DB walker)
  //
  // Deep-nesting note: when (b) recurses into a cached firstOption that
  // ITSELF contains `@{}` refs not yet cached, the inner replace lands
  // back here on the next pass. Cache-miss + fire `ensure()` for that
  // nested uuid so the next 400ms poll has it ready. Chain length N
  // therefore takes ~N polling ticks to fully expand; each tick
  // surfaces one more level instead of stalling at the first miss.
  out = out.replace(WC_REF_RE, (full, uuid) => {
    const target = catalog.get(uuid);
    const opts = target?.options ?? [];
    if (opts.length) {
      return expandValue(String(opts[0].value ?? ""), ctx, catalog, depth + 1);
    }
    const lk = previewLookup(uuid);
    if (lk?.firstOption !== undefined) {
      return expandValue(lk.firstOption, ctx, catalog, depth + 1);
    }
    if (lk === undefined) {
      // First time we see this uuid in any expansion path — queue it.
      // `ensure` is idempotent + fire-and-forget; subsequent ticks read
      // from cache via the branch above.
      ensurePreviewLookup([uuid]);
    }
    if (lk?.name) return `[${lk.name}]`;
    return full;
  });
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
 * BFS downstream from `node` along PIPELINE_CONTEXT edges, collecting every
 * wildcard module's uuid in any reachable WP_Context. Mirror of
 * {@link collectUpstreamWildcardUuids} for the conflict scanner's
 * constraint check — source-in-downstream is bad (source runs after
 * constraint = pick not yet recorded), target-in-downstream is good
 * (target runs after constraint = matrix gets a chance to apply).
 *
 * Skips modules in muted/bypassed nodes (mode 2 / 4) so a constraint
 * referencing a deliberately-disabled future wildcard doesn't get
 * misleading "this is fine" silence.
 *
 * Crosses subgraph boundaries the same way `findDownstreamAssemblers`
 * does (resumes from parent SubgraphNode through SubgraphOutputNode).
 */
export function collectDownstreamWildcardUuids(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): string[] {
  const parents = buildSubgraphParents(rootGraph);
  // Per-instance, not deduped. The conflict scanner's count-aware
  // `constraint_orphan_target` check needs the actual number of
  // downstream target instances available to claim — two constraints
  // targeting the same wildcard need two downstream slots. A Set would
  // collapse N siblings to 1, falsely orphaning every constraint past
  // the first when duplicates exist downstream.
  const out: string[] = [];
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
        // Harvest wildcard uuids when the downstream node is a
        // WP_Context and not muted/bypassed.
        if (stepped.node.type === "WP_Context" && !isSkippedMode(stepped.node)) {
          const v = parseWidgetJson<ContextWidgetValue>(
            widgetValue(stepped.node, "wp_modules"),
            { version: 1, modules: [] },
          );
          const bundleEnabled = buildBundleEnabledMap(v.bundles);
          for (const m of v.modules) {
            if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
            if (m.type === "wildcard") out.push(m.id);
          }
        }
        queue.push({ graph: stepped.graph, node: stepped.node });
      }
    }
  }
  return out;
}

/**
 * BFS downstream from `node` along PIPELINE_CONTEXT edges, harvesting
 * `@{uuid}` nested-ref uuids found inside any downstream wildcard's
 * option values. Mirrors pair-badge logic (`carrierOptionIdsFor`) so
 * the conflict scanner agrees with the badge: a constraint targeting
 * a wildcard that has no direct downstream instance but IS referenced
 * via `@{}` from a downstream carrier shouldn't warn orphan.
 *
 * One-hop only — pair badge also doesn't transitively chase nested
 * refs across nodes. Local same-node transitive walking is still
 * handled by `localNestedReachAfter` inside `scanConflicts`. The
 * asymmetry is intentional and matches the pair-time engine semantic.
 */
export function collectDownstreamNestedReachUuids(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): string[] {
  const parents = buildSubgraphParents(rootGraph);
  const out: string[] = [];
  const reach = new Set<string>();
  const seen = new Set<string>([locator(graphOf(node, rootGraph), node)]);
  const queue: { graph: LiteGraphLike; node: LiteNodeLike }[] = [
    { graph: graphOf(node, rootGraph), node },
  ];
  // Same regex shape used in pair-badge + dep-graph + tokenize. Uuid
  // captured; `#name` and `:subcat` segments non-capturing.
  const REF_RE = /@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g;

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
        if (stepped.node.type === "WP_Context" && !isSkippedMode(stepped.node)) {
          const v = parseWidgetJson<ContextWidgetValue>(
            widgetValue(stepped.node, "wp_modules"),
            { version: 1, modules: [] },
          );
          const bundleEnabled = buildBundleEnabledMap(v.bundles);
          for (const m of v.modules) {
            if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
            if (m.type !== "wildcard") continue;
            const payload = (m.payload ?? {}) as { options?: Array<{ value?: unknown }> };
            for (const opt of payload.options ?? []) {
              const val = opt.value;
              if (typeof val !== "string") continue;
              REF_RE.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = REF_RE.exec(val)) !== null) {
                if (!reach.has(match[1])) {
                  reach.add(match[1]);
                  out.push(match[1]);
                }
              }
            }
          }
        }
        queue.push({ graph: stepped.graph, node: stepped.node });
      }
    }
  }
  return out;
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
 * BFS downstream from `node` along PIPELINE_CONTEXT edges, returning every
 * downstream WP_Context node in execution order. Walks through subgraph
 * boundaries (same as {@link findDownstreamAssemblers}). Does NOT
 * include `node` itself; the caller is responsible for splicing it in
 * when assembling a full chain (so the caller controls where the
 * "own" position sits relative to the downstream tail).
 *
 * The BFS visit order matches the engine's runtime visit order along
 * each branch — a fan-out into multiple downstream Context nodes is
 * flattened in BFS order (first link first). For the typical linear
 * Context-chain this collapses to plain forward order.
 *
 * Skips mute/bypass nodes (mode 2 / 4) so the pairing scanner doesn't
 * count a deliberately-disabled future Context's wildcards as claim
 * targets.
 */
export function collectDownstreamContextNodes(
  rootGraph: LiteGraphLike,
  node: LiteNodeLike,
): LiteNodeLike[] {
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
        if (stepped.node.type === "WP_Context" && !isSkippedMode(stepped.node)) {
          out.push(stepped.node);
        }
        queue.push({ graph: stepped.graph, node: stepped.node });
      }
    }
  }
  return out;
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
