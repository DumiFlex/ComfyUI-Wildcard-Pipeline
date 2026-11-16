/**
 * The shared poll scheduler (perf pass P3): one interval for every
 * default-rate `reactiveFromGraph`, and `gated` pollers that recompute only
 * when the graph revision moved — bumped by events or by the per-tick
 * fingerprint — plus a periodic sweep while the user is active.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope } from "vue";
import { reactiveFromGraph, bumpGraphRevision, graphRevision } from "./reactive";
import { notifyGraphLoaded } from "./graph-events";

interface FakeNode {
  id: number;
  type: string;
  mode: number;
  title: string;
  graph?: unknown;
  inputs: { name: string; type: string; link: number | null }[];
  outputs: { name: string; type: string; links: number[] }[];
  widgets: { name: string; value: unknown }[];
  properties: Record<string, unknown>;
  onConnectionsChange?: (...a: unknown[]) => void;
}

function makeGraph() {
  const nodes: FakeNode[] = [1, 2].map((id) => ({
    id, type: "Thing", mode: 0, title: `n${id}`,
    inputs: [{ name: "in", type: "X", link: null }],
    outputs: [{ name: "out", type: "X", links: [] }],
    widgets: [{ name: "w", value: "a" }],
    properties: {},
  }));
  const graph = {
    _nodes: nodes,
    links: new Map<number, unknown>(),
    getNodeById: (id: number) => nodes.find((n) => n.id === id) ?? null,
  };
  (graph as { rootGraph?: unknown }).rootGraph = graph;
  for (const n of nodes) n.graph = graph;
  return { graph, nodes };
}

describe("shared poll scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  afterEach(() => vi.useRealTimers());

  function mountGated(node: FakeNode, read: () => unknown) {
    let computes = 0;
    const scope = effectScope();
    const r = scope.run(() => reactiveFromGraph(node, () => { computes += 1; return read(); }, Object.is, { gated: true }));
    if (!r) throw new Error("scope did not run");
    return { r, computes: () => computes, stop: () => scope.stop() };
  }

  it("runs every default-rate poller on ONE interval", () => {
    const spy = vi.spyOn(window, "setInterval");
    const { nodes } = makeGraph();
    const scope = effectScope();
    scope.run(() => {
      for (let i = 0; i < 10; i++) reactiveFromGraph(nodes[0], () => nodes[0].mode);
      for (let i = 0; i < 10; i++) reactiveFromGraph(nodes[1], () => nodes[1].title, Object.is, { gated: true });
    });
    expect(spy.mock.calls.filter((c) => c[1] === 400)).toHaveLength(1);
    scope.stop();
    spy.mockRestore();
  });

  it("a gated poller skips ticks while the graph is unchanged", () => {
    const { nodes } = makeGraph();
    const p = mountGated(nodes[0], () => nodes[1].widgets[0].value);
    vi.advanceTimersByTime(400 * 3); // first tick takes the fingerprint
    const settled = p.computes();
    vi.advanceTimersByTime(400 * 10);
    expect(p.computes()).toBe(settled);
    p.stop();
  });

  it("picks up an edit no event reports (a widget typed into on another node)", () => {
    const { nodes } = makeGraph();
    const p = mountGated(nodes[0], () => nodes[1].widgets[0].value);
    vi.advanceTimersByTime(400 * 2);
    nodes[1].widgets[0].value = "typed";
    vi.advanceTimersByTime(400);
    expect(p.r.value).toBe("typed");
    p.stop();
  });

  it("picks up a rewire, a mode change and a title change on another node", () => {
    const { graph, nodes } = makeGraph();
    const p = mountGated(nodes[0], () => `${graph.links.size}|${nodes[1].mode}|${nodes[1].title}`);
    vi.advanceTimersByTime(400 * 2);
    graph.links.set(5, { id: 5, origin_id: 2, origin_slot: 0, target_id: 1, target_slot: 0 });
    vi.advanceTimersByTime(400);
    expect(p.r.value).toBe("1|0|n2");
    nodes[1].mode = 4;
    vi.advanceTimersByTime(400);
    expect(p.r.value).toBe("1|4|n2");
    nodes[1].title = "renamed";
    vi.advanceTimersByTime(400);
    expect(p.r.value).toBe("1|4|renamed");
    p.stop();
  });

  it("recomputes in the next frame after an explicit bump, without waiting for a tick", () => {
    const { nodes } = makeGraph();
    let external = "x";
    const p = mountGated(nodes[0], () => external);
    vi.advanceTimersByTime(400 * 2);
    external = "y"; // outside the fingerprint
    const rev = graphRevision();
    bumpGraphRevision();
    expect(graphRevision()).toBe(rev + 1);
    vi.advanceTimersByTime(20); // one animation frame
    expect(p.r.value).toBe("y");
    p.stop();
  });

  it("a connection change on its own node refreshes it (next frame)", () => {
    const { nodes } = makeGraph();
    let external = 1;
    const p = mountGated(nodes[0], () => external);
    external = 2;
    nodes[0].onConnectionsChange?.();
    vi.advanceTimersByTime(20);
    expect(p.r.value).toBe(2);
    p.stop();
  });

  it("collapses a workflow load into one deferred pass (plus one late check)", () => {
    const { nodes } = makeGraph();
    let external = 1;
    const p = mountGated(nodes[0], () => external);
    vi.advanceTimersByTime(400 * 2);
    const before = p.computes();
    external = 2;
    notifyGraphLoaded();
    expect(p.computes()).toBe(before); // nothing synchronous
    vi.advanceTimersByTime(20);
    expect(p.r.value).toBe(2);
    vi.advanceTimersByTime(40); // the follow-up pass: fingerprint unchanged → skipped
    expect(p.computes()).toBe(before + 1);
    p.stop();
  });

  it("sweeps gated pollers every few seconds while the user is active, never while still", () => {
    const { nodes } = makeGraph();
    let external = "a";
    const p = mountGated(nodes[0], () => external);
    vi.advanceTimersByTime(5000);
    external = "b"; // missed by the fingerprint
    vi.advanceTimersByTime(8000);
    expect(p.r.value).toBe("a"); // still canvas: no sweep
    document.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(4400);
    expect(p.r.value).toBe("b");
    p.stop();
  });

  it("ungated pollers still run on every tick", () => {
    const { nodes } = makeGraph();
    let external = 1;
    const scope = effectScope();
    const r = scope.run(() => reactiveFromGraph(nodes[0], () => external));
    if (!r) throw new Error("scope did not run");
    external = 2;
    vi.advanceTimersByTime(400);
    expect(r.value).toBe(2);
    scope.stop();
  });
});
