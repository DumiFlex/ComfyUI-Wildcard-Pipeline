import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "#comfyui/app";
import { focusNode } from "./debug";

type Node = { id: number; type: string; graph?: unknown; subgraph?: unknown; flags?: { collapsed?: boolean }; collapse?: () => void };

function graphOf(nodes: Node[], id?: string) {
  const g = { id, getNodeById: (n: number) => nodes.find((x) => x.id === n) ?? null };
  for (const n of nodes) n.graph = g;
  return g;
}

describe("debug widget: show node", () => {
  const ctx: Node = { id: 7, type: "WP_Context" };
  const inner = graphOf([ctx], "sub-uuid");
  const wrapper: Node = { id: 5, type: "subgraph", subgraph: inner };
  const rootCtx: Node = { id: 2, type: "WP_Context" };
  const root = graphOf([wrapper, rootCtx]);
  let canvas: Record<string, ReturnType<typeof vi.fn> | unknown>;
  const holder = app as unknown as { graph: unknown; canvas?: unknown };
  const saved = holder.graph;

  beforeEach(() => {
    vi.useFakeTimers();
    holder.graph = root;
    canvas = {
      graph: root,
      setGraph: vi.fn((g: unknown) => { canvas.graph = g; }),
      selectNode: vi.fn(),
      centerOnNode: vi.fn(),
      setDirty: vi.fn(),
    };
    holder.canvas = canvas;
  });
  afterEach(() => {
    vi.useRealTimers();
    holder.graph = saved;
    delete holder.canvas;
  });

  it("centres a node in the graph on screen", () => {
    focusNode("2");
    expect(canvas.setGraph).not.toHaveBeenCalled();
    expect(canvas.selectNode).toHaveBeenCalledWith(rootCtx);
    expect(canvas.centerOnNode).toHaveBeenCalledWith(rootCtx);
  });

  it("opens the subgraph a node lives in, then centres it", () => {
    focusNode("5:7");
    expect(canvas.setGraph).toHaveBeenCalledWith(inner);
    expect(canvas.centerOnNode).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(canvas.selectNode).toHaveBeenCalledWith(ctx);
    expect(canvas.centerOnNode).toHaveBeenCalledWith(ctx);
  });

  it("steps back out to the root from inside a subgraph", () => {
    canvas.graph = inner;
    focusNode("2");
    expect(canvas.setGraph).toHaveBeenCalledWith(root);
    vi.runAllTimers();
    expect(canvas.centerOnNode).toHaveBeenCalledWith(rootCtx);
  });

  it("does nothing for an id that is not in the workflow", () => {
    focusNode("99");
    expect(canvas.setGraph).not.toHaveBeenCalled();
    expect(canvas.centerOnNode).not.toHaveBeenCalled();
  });
});
