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
