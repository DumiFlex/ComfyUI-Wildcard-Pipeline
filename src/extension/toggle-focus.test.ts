import { describe, expect, it } from "vitest";
import { ctlInputName, focusSpots, groupRect, nodeRect, unionRect, type CtlGraph, type CtlNode } from "./toggle-control";
import { frameRect } from "./bookmarks";

function makeGraph() {
  const nodes = new Map<number | string, CtlNode>();
  const links = new Map<number, { origin_id: number | string; origin_slot: number }>();
  const graph: CtlGraph & { groups: NonNullable<CtlGraph["groups"]> } = { links, getNodeById: (id) => nodes.get(id), groups: [] };
  let nextLink = 1;
  function add(id: number | string, extra: Partial<CtlNode> = {}): CtlNode {
    const n: CtlNode = { id, mode: 0, title: `Node ${id}`, inputs: [], graph, pos: [Number(id) * 100, 100], size: [80, 40], ...extra };
    nodes.set(id, n);
    return n;
  }
  function wire(from: CtlNode, to: CtlNode, inputName: string): void {
    const id = nextLink++;
    links.set(id, { origin_id: from.id, origin_slot: 0 });
    (to.inputs ??= []).push({ name: inputName, link: id });
  }
  return { graph, add, wire };
}

describe("toggle focus spots", () => {
  it("lists nothing while nothing is wired or named", () => {
    const g = makeGraph();
    expect(focusSpots(g.add(1), "a")).toEqual([]);
  });

  it("lists the wired node alone, past a reroute, with its rect", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const lora = g.add(2, { title: "LoRA" });
    const reroute = g.add(3, { type: "Reroute" });
    g.wire(lora, reroute, "in");
    g.wire(reroute, toggles, ctlInputName("a"));
    const spots = focusSpots(toggles, "a");
    expect(spots).toEqual([{ key: "n:2", label: "LoRA", kind: "node", count: 1, rect: [200, 70, 80, 70] }]);
  });

  it("prefers getBounding for a node's rect", () => {
    expect(nodeRect({ id: 1, getBounding: () => [1, 2, 3, 4] })).toEqual([1, 2, 3, 4]);
    expect(nodeRect({ id: 1 })).toBeNull();
  });

  it("lists named groups and puts All targets first when there are several", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const a = g.add(2);
    const b = g.add(3);
    const c = g.add(4);
    g.wire(a, toggles, ctlInputName("t"));
    g.graph.groups.push({ title: "Upscale", _children: new Set([b, c]), _bounding: [500, 0, 300, 200] });
    const spots = focusSpots(toggles, "t", ["Upscale"]);
    expect(spots.map((s) => [s.key, s.kind, s.label, s.count])).toEqual([
      ["all", "all", "All targets", 3],
      ["n:2", "node", "Node 2", 1],
      ["g:0", "group", "Upscale", 2],
    ]);
    expect(spots[0]?.rect).toEqual([200, 0, 600, 200]);
  });

  it("hidden dot: only the named groups count", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    g.wire(g.add(2), toggles, ctlInputName("t"));
    g.graph.groups.push({ title: "G", _children: new Set([g.add(3)]), pos: [0, 0], size: [10, 10] });
    expect(focusSpots(toggles, "t", ["G"], false).map((s) => s.key)).toEqual(["g:0"]);
  });

  it("a WP Node Group shows the canvas group it covers, else the nodes wired into it", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const ng = g.add(2, { type: "WP_NodeGroup" });
    const x = g.add(3);
    g.wire(ng, toggles, ctlInputName("t"));
    g.graph.groups.push({ title: "Detailers", _children: new Set([ng, x]), _bounding: [0, 0, 400, 300] });
    expect(focusSpots(toggles, "t").map((s) => [s.key, s.label, s.count])).toEqual([["g:0", "Detailers", 2]]);

    const y = g.add(4);
    const z = g.add(5);
    g.wire(y, ng, "node_1");
    g.wire(z, ng, "node_2");
    expect(focusSpots(toggles, "t").map((s) => s.key)).toEqual(["all", "n:4", "n:5"]);
  });

  it("a group named twice or also covered is listed once", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const ng = g.add(2, { type: "WP_NodeGroup" });
    g.wire(ng, toggles, ctlInputName("t"));
    g.graph.groups.push({ title: "G", _children: new Set([ng]), _bounding: [0, 0, 10, 10] });
    expect(focusSpots(toggles, "t", ["G", "G"]).map((s) => s.key)).toEqual(["g:0"]);
  });

  it("rect helpers", () => {
    expect(groupRect({})).toBeNull();
    expect(unionRect([])).toBeNull();
    expect(unionRect([[0, 0, 10, 10], [-5, 20, 10, 10]])).toEqual([-5, 0, 15, 30]);
  });
});

describe("frameRect", () => {
  it("centres a small rect at no more than the zoom cap", () => {
    const { scale, offset } = frameRect([100, 100, 100, 50], [1000, 800], [0, 0, 0, 0], 20, 1);
    expect(scale).toBe(1);
    // Rect centre (150, 125) lands on the screen centre (500, 400).
    expect((150 + offset[0]) * scale).toBeCloseTo(500);
    expect((125 + offset[1]) * scale).toBeCloseTo(400);
  });

  it("zooms out to fit a big rect inside the free area", () => {
    const { scale, offset } = frameRect([0, 0, 4000, 1000], [1000, 800], [100, 50, 0, 0], 0, 1);
    expect(scale).toBeCloseTo(900 / 4000);
    expect((2000 + offset[0]) * scale).toBeCloseTo(100 + 450);
    expect((500 + offset[1]) * scale).toBeCloseTo(50 + 375);
  });

  it("never goes under the zoom floor", () => {
    expect(frameRect([0, 0, 1e6, 1e6], [1000, 800]).scale).toBe(0.1);
  });
});
