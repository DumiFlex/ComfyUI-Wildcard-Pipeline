import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPH_SWITCH_SETTLE_MS, showGraph, type LiteGraphLike } from "./graph";

function graph(id?: string): LiteGraphLike {
  return { id, _nodes: [], links: {}, getNodeById: () => null };
}

describe("showGraph", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs at once when the graph is already on screen", () => {
    const g = graph();
    const setGraph = vi.fn();
    const then = vi.fn();
    expect(showGraph({ graph: g, setGraph }, g, then)).toBe(true);
    expect(setGraph).not.toHaveBeenCalled();
    expect(then).toHaveBeenCalledOnce();
  });

  it("opens a subgraph first and waits for the viewport restore", () => {
    const root = graph();
    const sub = graph("sub-1");
    const canvas = { graph: root as LiteGraphLike | null, setGraph: vi.fn((g: LiteGraphLike) => { canvas.graph = g; }) };
    const then = vi.fn();
    expect(showGraph(canvas, sub, then)).toBe(true);
    expect(canvas.setGraph).toHaveBeenCalledWith(sub);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GRAPH_SWITCH_SETTLE_MS);
    expect(then).toHaveBeenCalledOnce();
  });

  it("steps back out to the root from inside a subgraph", () => {
    const root = graph();
    const sub = graph("sub-1");
    const setGraph = vi.fn();
    const then = vi.fn();
    showGraph({ graph: sub, setGraph }, root, then);
    expect(setGraph).toHaveBeenCalledWith(root);
    vi.advanceTimersByTime(GRAPH_SWITCH_SETTLE_MS);
    expect(then).toHaveBeenCalledOnce();
  });

  it("skips when the canvas can't switch graphs", () => {
    const then = vi.fn();
    expect(showGraph({ graph: graph() }, graph("sub-1"), then)).toBe(false);
    vi.runAllTimers();
    expect(then).not.toHaveBeenCalled();
  });

  it("runs at once when no graph is given", () => {
    const then = vi.fn();
    showGraph({ graph: graph() }, null, then);
    expect(then).toHaveBeenCalledOnce();
  });
});
