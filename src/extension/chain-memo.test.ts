/**
 * Memoised chain readers (perf pass P3): they hand back the SAME object while
 * nothing they read has changed, and a fresh one the moment anything does.
 * The polls rely on the first half to skip work; correctness relies on the
 * second.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  collectUpstreamProducers,
  collectDownstreamContextNodes,
  collectDownstreamWildcardUuids,
  collectUpstreamVariables,
  withWalkCache,
  invalidateWalkCache,
  _clearParseCacheForTests,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";
import { collectCrossNodePairingsFull, collectFullChainModules } from "./cross-node-pairings";

function body(id: number, extra = ""): string {
  return JSON.stringify({
    version: 1,
    modules: [{
      id: `w${id}`.padEnd(8, "0").slice(0, 8),
      _uid: `u${id}`,
      type: "wildcard",
      enabled: true,
      meta: { name: `Wild ${id}${extra}` },
      payload: { var_binding: `v${id}`, options: [{ id: "o0", value: `val ${id}${extra}`, weight: 1 }] },
    }],
  });
}

type Node = LiteNodeLike & { widgets: { name: string; value: unknown }[]; mode?: number; title?: string };

/** ctx(1) -> ctx(2) -> ctx(3), links 11 and 12 */
function chain(): { graph: LiteGraphLike; nodes: Node[]; links: Record<number, unknown> } {
  const mk = (id: number, inLink: number | null, outLinks: number[]): Node => ({
    id,
    type: "WP_Context",
    mode: 0,
    title: `Ctx ${id}`,
    inputs: [{ name: "upstream", link: inLink, type: "PIPELINE_CONTEXT" }],
    outputs: [{ name: "context", links: outLinks, type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: body(id) }],
  }) as unknown as Node;
  const nodes = [mk(1, null, [11]), mk(2, 11, [12]), mk(3, 12, [])];
  const links: Record<number, unknown> = {
    11: { id: 11, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
    12: { id: 12, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
  };
  const graph = {
    _nodes: nodes,
    links,
    getNodeById: (id: number) => nodes.find((n) => Number(n.id) === Number(id)) ?? null,
  } as unknown as LiteGraphLike;
  for (const n of nodes) (n as { graph?: LiteGraphLike }).graph = graph;
  return { graph, nodes, links };
}

beforeEach(() => _clearParseCacheForTests());

describe("collectFullChainModules memo", () => {
  it("returns the same array and the same pairings map while nothing changed", () => {
    const { graph, nodes } = chain();
    const a = collectFullChainModules(graph, nodes[1]);
    const b = collectFullChainModules(graph, nodes[1]);
    expect(b).toBe(a);
    expect(a.map((m) => m.rowKey)).toEqual(["1#u1", "2#u2", "3#u3"]);
    expect(collectCrossNodePairingsFull(graph, nodes[1])).toBe(collectCrossNodePairingsFull(graph, nodes[1]));
  });

  it("rebuilds after a downstream body edit, keeping the untouched entries", () => {
    const { graph, nodes } = chain();
    const a = collectFullChainModules(graph, nodes[0]);
    nodes[2].widgets[0].value = body(3, " edited");
    const b = collectFullChainModules(graph, nodes[0]);
    expect(b).not.toBe(a);
    expect(b[2].displayName).toBe("Wild 3 edited");
    // Entries of unedited nodes are reused, so a chain compare skips them.
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
  });

  it("rebuilds when an upstream Context is muted", () => {
    const { graph, nodes } = chain();
    const a = collectFullChainModules(graph, nodes[2]);
    nodes[0].mode = 2;
    const b = collectFullChainModules(graph, nodes[2]);
    expect(b).not.toBe(a);
    expect(b.map((m) => m.rowKey)).not.toContain("1#u1");
  });

  it("rebuilds when the chain is rewired", () => {
    const { graph, nodes, links } = chain();
    const a = collectFullChainModules(graph, nodes[0]);
    delete links[12];
    (nodes[1].outputs as { links: number[] }[])[0].links = [];
    (nodes[2].inputs as { link: number | null }[])[0].link = null;
    const b = collectFullChainModules(graph, nodes[0]);
    expect(b).not.toBe(a);
    expect(b.map((m) => m.rowKey)).toEqual(["1#u1", "2#u2"]);
  });
});

describe("collectUpstreamProducers memo", () => {
  it("same map until a body, mode or title it reads changes", () => {
    const { graph, nodes } = chain();
    const a = collectUpstreamProducers(graph, nodes[2]);
    expect(collectUpstreamProducers(graph, nodes[2])).toBe(a);
    expect(Object.keys(a).sort()).toEqual(["v1", "v2"]);

    nodes[1].widgets[0].value = body(2, " x");
    const b = collectUpstreamProducers(graph, nodes[2]);
    expect(b).not.toBe(a);
    expect(b.v2.moduleName).toBe("Wild 2 x");

    nodes[0].mode = 4;
    const c = collectUpstreamProducers(graph, nodes[2]);
    expect(c).not.toBe(b);
    expect(Object.keys(c)).toEqual(["v2"]);

    nodes[0].mode = 0;
    nodes[0].title = "Renamed";
    expect(collectUpstreamProducers(graph, nodes[2])).not.toBe(c);
  });
});

describe("withWalkCache", () => {
  it("shares walks inside the scope and forgets them after", () => {
    const { graph, nodes, links } = chain();
    withWalkCache(() => {
      expect(collectDownstreamContextNodes(graph, nodes[0]).map((n) => n.id)).toEqual([2, 3]);
      // Rewired mid-scope without telling the cache: the walk is reused...
      delete links[12];
      (nodes[1].outputs as { links: number[] }[])[0].links = [];
      expect(collectDownstreamContextNodes(graph, nodes[0]).map((n) => n.id)).toEqual([2, 3]);
      // ...until it is invalidated.
      invalidateWalkCache();
      expect(collectDownstreamContextNodes(graph, nodes[0]).map((n) => n.id)).toEqual([2]);
    });
    // Outside a scope every call walks afresh.
    (nodes[1].outputs as { links: number[] }[])[0].links = [12];
    links[12] = { id: 12, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 };
    expect(collectDownstreamContextNodes(graph, nodes[0]).map((n) => n.id)).toEqual([2, 3]);
  });

  it("gives the same answers inside and outside a scope", () => {
    const { graph, nodes } = chain();
    const outside = {
      vars: collectUpstreamVariables(graph, nodes[2]),
      down: collectDownstreamWildcardUuids(graph, nodes[0]),
    };
    const inside = withWalkCache(() => ({
      vars: collectUpstreamVariables(graph, nodes[2]),
      down: collectDownstreamWildcardUuids(graph, nodes[0]),
    }));
    expect(inside).toEqual(outside);
  });
});
