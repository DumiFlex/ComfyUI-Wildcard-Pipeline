// workflowSiblingCount — counts uuid instances across all WP_Context
// nodes in the workflow (including nested subgraphs). Used by the
// save-to-library fork-detection path: when count > 1, a save creates
// a new library entry instead of overwriting the shared one.

import { describe, it, expect } from "vitest";
import { workflowSiblingCount } from "./sibling-count";

interface FakeWidget {
  type?: string;
  value?: { modules?: Array<{ id: string }> };
}
interface FakeNode {
  type?: string;
  widgets?: FakeWidget[];
  subgraph?: FakeGraph;
}
interface FakeGraph {
  _nodes: FakeNode[];
}

function ctx(modIds: string[]): FakeNode {
  return {
    type: "WP_Context",
    widgets: [{ type: "WP_CONTEXT_MODULES", value: { modules: modIds.map((id) => ({ id })) } }],
  };
}

describe("workflowSiblingCount", () => {
  it("returns 0 when uuid not present anywhere", () => {
    const graph: FakeGraph = { _nodes: [ctx(["aaa", "bbb"])] };
    expect(workflowSiblingCount("xxx", graph as never)).toBe(0);
  });

  it("counts a single instance", () => {
    const graph: FakeGraph = { _nodes: [ctx(["aaa", "bbb"])] };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(1);
  });

  it("counts multiple instances within a single WP_Context (siblings)", () => {
    const graph: FakeGraph = { _nodes: [ctx(["aaa", "aaa", "bbb"])] };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(2);
  });

  it("counts instances across multiple WP_Context nodes", () => {
    const graph: FakeGraph = {
      _nodes: [ctx(["aaa", "bbb"]), ctx(["aaa", "ccc"]), ctx(["aaa"])],
    };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(3);
  });

  it("counts instances inside nested subgraphs", () => {
    const inner: FakeGraph = { _nodes: [ctx(["aaa"])] };
    const subgraphHost: FakeNode = { type: "Subgraph", subgraph: inner };
    const graph: FakeGraph = { _nodes: [ctx(["aaa"]), subgraphHost] };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(2);
  });

  it("ignores non-WP_Context nodes", () => {
    const noise: FakeNode = { type: "KSampler", widgets: [] };
    const graph: FakeGraph = { _nodes: [ctx(["aaa"]), noise] };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(1);
  });

  it("ignores WP_Context nodes whose widget has no modules array", () => {
    const broken: FakeNode = { type: "WP_Context", widgets: [{ type: "WP_CONTEXT_MODULES", value: {} }] };
    const graph: FakeGraph = { _nodes: [ctx(["aaa"]), broken] };
    expect(workflowSiblingCount("aaa", graph as never)).toBe(1);
  });
});
