import { describe, it, expect } from "vitest";
import {
  collectUpstreamVariables,
  findDownstreamAssemblers,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";

function fakeContextNode(id: number, vars: string[], upstreamLink?: number): LiteNodeLike {
  return {
    id,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: upstreamLink ?? null }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{
      name: "modules",
      value: JSON.stringify({
        version: 1,
        modules: [{
          id: "a",
          type: "fixed_values",
          enabled: true,
          meta: { name: "" },
          entries: vars.map((v) => ({ variable_name: v, value: "x" })),
        }],
      }),
    }],
  };
}

describe("collectUpstreamVariables", () => {
  it("returns the upstream chain's writes only — never the starting node's own", () => {
    const a = fakeContextNode(1, ["style"]);
    const b = fakeContextNode(2, ["mood"], 100);
    const graph: LiteGraphLike = {
      _nodes: [a, b],
      links: { 100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id) => ({ 1: a, 2: b } as Record<number, LiteNodeLike>)[id] ?? null,
    };
    // From b's POV: only "style" comes from upstream; b's own "mood" is not included.
    expect(collectUpstreamVariables(graph, b)).toEqual(["style"]);
  });

  it("returns empty when no upstream link, regardless of own writes", () => {
    const a = fakeContextNode(1, ["style"]);
    const graph: LiteGraphLike = { _nodes: [a], links: {}, getNodeById: () => null };
    expect(collectUpstreamVariables(graph, a)).toEqual([]);
  });

  it("walks via assembler's `context` input too — any PIPELINE_CONTEXT slot works", () => {
    const ctx = fakeContextNode(1, ["style", "subject"]);
    const asm: LiteNodeLike = {
      id: 2,
      type: "WP_PromptAssembler",
      // Note: input is named "context", not "upstream".
      inputs: [{ name: "context", link: 300 }],
    };
    const graph: LiteGraphLike = {
      _nodes: [ctx, asm],
      links: { 300: { id: 300, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id) => ({ 1: ctx, 2: asm } as Record<number, LiteNodeLike>)[id] ?? null,
    };
    expect(collectUpstreamVariables(graph, asm).sort()).toEqual(["style", "subject"]);
  });
});

describe("findDownstreamAssemblers", () => {
  it("returns assembler ids reachable via PIPELINE_CONTEXT outgoing links", () => {
    const ctx: LiteNodeLike = {
      id: 1,
      type: "WP_Context",
      outputs: [{ name: "context", links: [200], type: "PIPELINE_CONTEXT" }],
    };
    const asm: LiteNodeLike = { id: 2, type: "WP_PromptAssembler", inputs: [{ name: "context", link: 200 }] };
    const graph: LiteGraphLike = {
      _nodes: [ctx, asm],
      links: { 200: { id: 200, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id) => ({ 1: ctx, 2: asm } as Record<number, LiteNodeLike>)[id] ?? null,
    };
    expect(findDownstreamAssemblers(graph, ctx).map((n) => n.id)).toEqual([2]);
  });
});

// ── Subgraph boundary traversal ────────────────────────────────────────
// The chain crosses litegraph subgraph boundaries via two proxy nodes:
//   - SubgraphInputNode  (id = -10) — boundary inside the subgraph that
//     proxies external inputs.
//   - SubgraphOutputNode (id = -20) — boundary inside the subgraph that
//     proxies external outputs.
// We model both shapes here and assert the walk doesn't get stuck on either.

describe("collectUpstreamVariables across subgraph boundaries", () => {
  it("steps OUT of a subgraph to reach an upstream Context in the parent graph", () => {
    // Layout:
    //   root: ctx(1) ──[100]──▶ subNode(10)
    //   inside subNode.subgraph: -10 ──[200]──▶ asm(2)
    //   subNode's "ctx" input maps by name to the inputNode's "ctx" slot.
    const ctx = fakeContextNode(1, ["style"]);
    ctx.outputs = [{ name: "context", links: [100], type: "PIPELINE_CONTEXT" }];

    const innerAsm: LiteNodeLike = {
      id: 2,
      type: "WP_PromptAssembler",
      inputs: [{ name: "context", link: 200 }],
    };
    const subgraph: LiteGraphLike = {
      id: "sg-1",
      _nodes: [innerAsm],
      links: { 200: { id: 200, origin_id: -10, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id) => ({ 2: innerAsm } as Record<number, LiteNodeLike>)[id] ?? null,
      inputNode: { id: -10, slots: [{ name: "ctx", linkIds: [200] }] },
      outputNode: { id: -20, slots: [] },
    };
    innerAsm.graph = subgraph;

    const subNode: LiteNodeLike = {
      id: 10,
      type: "Subgraph",
      inputs: [{ name: "ctx", link: 100 }],
      outputs: [{ name: "ctx_out", links: [], type: "PIPELINE_CONTEXT" }],
      subgraph,
      isSubgraphNode: () => true,
    };
    const root: LiteGraphLike = {
      _nodes: [ctx, subNode],
      links: { 100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 10, target_slot: 0 } },
      getNodeById: (id) => ({ 1: ctx, 10: subNode } as Record<number, LiteNodeLike>)[id] ?? null,
    };
    ctx.graph = root;
    subNode.graph = root;

    expect(collectUpstreamVariables(root, innerAsm)).toEqual(["style"]);
  });

  it("steps INTO a subgraph when the upstream Context lives inside one", () => {
    // Layout:
    //   inside subgraph: ctx(1) ──[200]──▶ -20 (output proxy, slot "ctx_out")
    //   root:            subNode(10) ──[300]──▶ asm(2)
    const innerCtx = fakeContextNode(1, ["style"]);
    innerCtx.outputs = [{ name: "context", links: [200], type: "PIPELINE_CONTEXT" }];

    const subgraph: LiteGraphLike = {
      id: "sg-1",
      _nodes: [innerCtx],
      links: { 200: { id: 200, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0 } },
      getNodeById: (id) => ({ 1: innerCtx } as Record<number, LiteNodeLike>)[id] ?? null,
      inputNode: { id: -10, slots: [] },
      outputNode: { id: -20, slots: [{ name: "ctx_out", linkIds: [200] }] },
    };
    innerCtx.graph = subgraph;

    const subNode: LiteNodeLike = {
      id: 10,
      type: "Subgraph",
      inputs: [],
      outputs: [{ name: "ctx_out", links: [300], type: "PIPELINE_CONTEXT" }],
      subgraph,
      isSubgraphNode: () => true,
    };
    const asm: LiteNodeLike = {
      id: 2,
      type: "WP_PromptAssembler",
      inputs: [{ name: "context", link: 300 }],
    };
    const root: LiteGraphLike = {
      _nodes: [subNode, asm],
      links: { 300: { id: 300, origin_id: 10, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id) => ({ 10: subNode, 2: asm } as Record<number, LiteNodeLike>)[id] ?? null,
    };
    subNode.graph = root;
    asm.graph = root;

    expect(collectUpstreamVariables(root, asm)).toEqual(["style"]);
  });
});
