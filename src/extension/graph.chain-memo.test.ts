/**
 * The resolved-chain memo must be invisible: every answer it gives has to be
 * the answer `resolveChainStatic` would give for the graph as it is now.
 * These tests change each input the memo keys on and check the answer moves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  collectUpstreamResolved,
  _setChainMemoForTests,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";
import { _resetForTests, _setForTests } from "./preview-resolver";

vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

function contextNode(id: number, upstreamLink: number | null, value: string): LiteNodeLike {
  const modules = [{
    id: `w000000${id}`,
    _uid: `u${id}`,
    type: "wildcard",
    enabled: true,
    payload: { var_binding: `v${id}`, options: [{ id: "o0", value, weight: 1 }] },
  }];
  return {
    id,
    type: "WP_Context",
    mode: 0,
    inputs: [{ name: "upstream", link: upstreamLink }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules }) }],
  } as unknown as LiteNodeLike;
}

/** context(1) -> context(2) -> context(3); returns all three. */
function buildChain(firstValue = "red"): { graph: LiteGraphLike; nodes: LiteNodeLike[] } {
  const nodes = [
    contextNode(1, null, firstValue),
    contextNode(2, 11, "blue"),
    contextNode(3, 12, "green"),
  ];
  const graph = {
    _nodes: nodes,
    links: {
      11: { id: 11, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      12: { id: 12, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
    },
    getNodeById: (id: number) => nodes.find((n) => Number(n.id) === Number(id)) ?? null,
  } as unknown as LiteGraphLike;
  return { graph, nodes };
}

function setModules(node: LiteNodeLike, value: string): void {
  const w = (node.widgets ?? []).find((x) => x.name === "wp_modules");
  const parsed = JSON.parse(String(w!.value));
  parsed.modules[0].payload.options[0].value = value;
  w!.value = JSON.stringify(parsed);
}

describe("resolved-chain memo", () => {
  beforeEach(() => { _resetForTests(); _setChainMemoForTests(true); });
  afterEach(() => { _setChainMemoForTests(true); });

  it("gives the same answer as the unmemoised walk", () => {
    const { graph, nodes } = buildChain();
    const memo = collectUpstreamResolved(graph, nodes[2]);
    const again = collectUpstreamResolved(graph, nodes[2]);
    _setChainMemoForTests(false);
    const plain = collectUpstreamResolved(graph, nodes[2]);
    expect(memo).toEqual(plain);
    expect(again).toEqual(plain);
    expect(plain).toMatchObject({ v1: "red", v2: "blue" });
  });

  it("picks up an edit to an upstream node's modules", () => {
    const { graph, nodes } = buildChain();
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBe("red");
    setModules(nodes[0], "purple");
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBe("purple");
  });

  it("picks up a mute on an upstream node", () => {
    const { graph, nodes } = buildChain();
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBe("red");
    (nodes[0] as { mode?: number }).mode = 2;
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBeUndefined();
  });

  it("picks up a rewired chain", () => {
    const { graph, nodes } = buildChain();
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBe("red");
    // Cut 1 -> 2: node 3 now only sees node 2.
    (nodes[1].inputs ?? [])[0].link = null;
    const after = collectUpstreamResolved(graph, nodes[2]);
    expect(after.v1).toBeUndefined();
    expect(after.v2).toBe("blue");
  });

  it("re-resolves when a nested ref's lookup arrives", () => {
    const { graph, nodes } = buildChain("@{abcdef01#hair}");
    const before = collectUpstreamResolved(graph, nodes[2]).v1;
    _setForTests("abcdef01", { name: "hair", kind: "wildcard", firstOption: "long hair" });
    const after = collectUpstreamResolved(graph, nodes[2]).v1;
    expect(after).toBe("long hair");
    expect(after).not.toBe(before);
  });

  it("hands each caller its own map", () => {
    const { graph, nodes } = buildChain();
    const first = collectUpstreamResolved(graph, nodes[2]);
    first.v1 = "scribbled";
    expect(collectUpstreamResolved(graph, nodes[2]).v1).toBe("red");
  });

  it("shares one entry between nodes fed by the same upstream", () => {
    const { graph, nodes } = buildChain();
    const sibling = contextNode(4, 13, "x");
    (graph as unknown as { _nodes: LiteNodeLike[] })._nodes.push(sibling);
    (graph.links as Record<number, unknown>)[13] =
      { id: 13, origin_id: 2, origin_slot: 0, target_id: 4, target_slot: 0 };
    expect(collectUpstreamResolved(graph, sibling))
      .toEqual(collectUpstreamResolved(graph, nodes[2]));
  });
});
