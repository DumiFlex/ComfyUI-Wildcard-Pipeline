import { describe, it, expect } from "vitest";
import { collectFullChainModules } from "./cross-node-pairings";
import type { LiteGraphLike, LiteNodeLike } from "./graph";

/** Build a WP_Context node carrying `modules` + an optional persisted
 *  `node_label`. Mirrors the widget-JSON shape graph.ts reads under the
 *  `wp_modules` widget. `upstreamLink` wires this node's PIPELINE_CONTEXT
 *  input to the link id of its upstream producer; `downstreamLinks` lists
 *  the link ids flowing OUT of its PIPELINE_CONTEXT output. */
function ctxNode(
  id: number,
  modules: Array<Record<string, unknown>>,
  opts: { nodeLabel?: string; upstreamLink?: number; downstreamLinks?: number[] } = {},
): LiteNodeLike {
  const value: Record<string, unknown> = { version: 1, modules };
  if (opts.nodeLabel !== undefined) value.node_label = opts.nodeLabel;
  return {
    id,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: opts.upstreamLink ?? null, type: "PIPELINE_CONTEXT" }],
    outputs: [{ name: "context", links: opts.downstreamLinks ?? [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify(value) }],
  };
}

const wildcard = (id: string): Record<string, unknown> => ({
  id,
  _uid: `${id}-uid`,
  type: "wildcard",
  enabled: true,
  meta: { name: id },
  entries: [],
  payload: { var_binding: id, options: [] },
});

describe("collectFullChainModules — nodeLabel tagging", () => {
  it("tags each flattened module with its node's explicit node_label", () => {
    // A → B chain. A is upstream of B; both carry explicit labels.
    const a = ctxNode(1, [wildcard("aa")], { nodeLabel: "Base", downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { nodeLabel: "Detail", upstreamLink: 100 });
    const graph: LiteGraphLike = {
      _nodes: [a, b],
      links: { 100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (n) => ({ 1: a, 2: b } as Record<number, LiteNodeLike>)[n] ?? null,
    };

    // Walk from B's POV: chain is [A (upstream), B (own)].
    const out = collectFullChainModules(graph, b);
    const aMod = out.find((m) => m.id === "aa");
    const bMod = out.find((m) => m.id === "bb");
    expect(aMod?.nodeLabel).toBe("Base");
    expect(bMod?.nodeLabel).toBe("Detail");
  });

  it("falls back to auto upstream→downstream letters (A, B, C…) when node_label is unset", () => {
    // A → B → C chain, no explicit labels. Walked from B's POV the order
    // is [A (upstream), B (own), C (downstream)] → letters A, B, C.
    const a = ctxNode(1, [wildcard("aa")], { downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { upstreamLink: 100, downstreamLinks: [200] });
    const c = ctxNode(3, [wildcard("cc")], { upstreamLink: 200 });
    const graph: LiteGraphLike = {
      _nodes: [a, b, c],
      links: {
        100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
        200: { id: 200, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
      },
      getNodeById: (n) => ({ 1: a, 2: b, 3: c } as Record<number, LiteNodeLike>)[n] ?? null,
    };

    const out = collectFullChainModules(graph, b);
    expect(out.find((m) => m.id === "aa")?.nodeLabel).toBe("A");
    expect(out.find((m) => m.id === "bb")?.nodeLabel).toBe("B");
    expect(out.find((m) => m.id === "cc")?.nodeLabel).toBe("C");
  });

  it("mixes explicit + auto: a labelled node keeps its label, neighbours fall back to their letter", () => {
    const a = ctxNode(1, [wildcard("aa")], { downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { nodeLabel: "Mid", upstreamLink: 100, downstreamLinks: [200] });
    const c = ctxNode(3, [wildcard("cc")], { upstreamLink: 200 });
    const graph: LiteGraphLike = {
      _nodes: [a, b, c],
      links: {
        100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
        200: { id: 200, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
      },
      getNodeById: (n) => ({ 1: a, 2: b, 3: c } as Record<number, LiteNodeLike>)[n] ?? null,
    };

    const out = collectFullChainModules(graph, b);
    // A and C have no label → auto letters by position; B keeps "Mid".
    expect(out.find((m) => m.id === "aa")?.nodeLabel).toBe("A");
    expect(out.find((m) => m.id === "bb")?.nodeLabel).toBe("Mid");
    expect(out.find((m) => m.id === "cc")?.nodeLabel).toBe("C");
  });

  it("single own node with no label defaults to letter A", () => {
    const a = ctxNode(1, [wildcard("aa")]);
    const graph: LiteGraphLike = {
      _nodes: [a],
      links: {},
      getNodeById: (n) => ({ 1: a } as Record<number, LiteNodeLike>)[n] ?? null,
    };
    const out = collectFullChainModules(graph, a);
    expect(out.find((m) => m.id === "aa")?.nodeLabel).toBe("A");
  });
});
