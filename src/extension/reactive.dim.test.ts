import { describe, it, expect } from "vitest";
import { dimWidgetsWhileSkipped, SKIPPED_OPACITY } from "./reactive";

function makeNode(mode = 0) {
  const el = (): HTMLElement => document.createElement("textarea");
  return {
    mode,
    widgets: [
      { name: "prompt", element: el() },
      { name: "negative", element: el() },
      { name: "rules", element: el() },
      { name: "seed" },
    ],
  };
}
const opacity = (n: ReturnType<typeof makeNode>, i: number) => n.widgets[i].element?.style.opacity;

describe("dimWidgetsWhileSkipped", () => {
  it("dims the named widgets on bypass and mute, and restores them", () => {
    const node = makeNode();
    dimWidgetsWhileSkipped(node, ["prompt", "negative"]);
    expect(opacity(node, 0)).toBe("");
    node.mode = 4;
    expect(opacity(node, 0)).toBe(SKIPPED_OPACITY);
    expect(opacity(node, 1)).toBe(SKIPPED_OPACITY);
    expect(opacity(node, 2)).toBe("");
    node.mode = 0;
    expect(opacity(node, 0)).toBe("");
    node.mode = 2;
    expect(opacity(node, 1)).toBe(SKIPPED_OPACITY);
  });

  it("dims straight away for a node that starts bypassed", () => {
    const node = makeNode(4);
    dimWidgetsWhileSkipped(node, ["prompt"]);
    expect(opacity(node, 0)).toBe(SKIPPED_OPACITY);
  });
});

describe("mode intercept keeps the host's accessor", () => {
  /** Mirrors the frontend's `LGraphNodeProperties`: an own accessor on
   *  `mode` whose setter emits the change Nodes 2.0 listens for. */
  function instrumented(start = 0) {
    const node = makeNode();
    const events: [number, number][] = [];
    let value = start;
    Object.defineProperty(node, "mode", {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next: number) => {
        if (next !== value) events.push([value, next]);
        value = next;
      },
    });
    return { node, events };
  }

  it("still fires the host setter on bypass, so Vue nodes see it", () => {
    const { node, events } = instrumented();
    dimWidgetsWhileSkipped(node, ["prompt"]);
    node.mode = 4;
    expect(events).toEqual([[0, 4]]);
    expect(node.mode).toBe(4);
    expect(opacity(node, 0)).toBe(SKIPPED_OPACITY);
    node.mode = 0;
    expect(events).toEqual([[0, 4], [4, 0]]);
    expect(opacity(node, 0)).toBe("");
  });

  it("chains once when several widgets watch the same node", () => {
    const { node, events } = instrumented(2);
    dimWidgetsWhileSkipped(node, ["prompt"]);
    dimWidgetsWhileSkipped(node, ["negative"]);
    expect(node.mode).toBe(2);
    node.mode = 4;
    expect(events).toEqual([[2, 4]]);
    expect(opacity(node, 0)).toBe(SKIPPED_OPACITY);
    expect(opacity(node, 1)).toBe(SKIPPED_OPACITY);
  });
});
