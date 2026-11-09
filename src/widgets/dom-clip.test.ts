import { afterEach, describe, expect, it } from "vitest";
import { clipPathFor, type ClipNode, registerOverlapClip, resetOverlapClipForTests, subtractRect, updateClips, type Rect } from "./dom-clip";

afterEach(() => resetOverlapClipForTests());

function area(rs: Rect[]): number {
  return rs.reduce((n, r) => n + r[2] * r[3], 0);
}

describe("subtractRect", () => {
  it("keeps a rect a hole misses", () => {
    const base: Rect = [0, 0, 10, 10];
    expect(subtractRect(base, [20, 20, 5, 5])).toEqual([base]);
  });
  it("cuts a hole in the middle into four bands", () => {
    const parts = subtractRect([0, 0, 10, 10], [3, 3, 4, 4]);
    expect(parts).toHaveLength(4);
    expect(area(parts)).toBe(100 - 16);
  });
  it("leaves nothing when the hole covers it", () => {
    expect(subtractRect([2, 2, 4, 4], [0, 0, 10, 10])).toEqual([]);
  });
});

describe("clipPathFor", () => {
  it("is empty when no hole touches the box", () => {
    expect(clipPathFor(100, 50, [[200, 0, 10, 10]])).toBe("");
  });
  it("cuts out a node over the bottom-left corner", () => {
    expect(clipPathFor(100, 50, [[-20, 30, 50, 40]])).toBe('path("M0 0h100v30h-100ZM30 30h70v20h-70Z")');
  });
  it("handles holes that overlap each other", () => {
    const clip = clipPathFor(100, 100, [[0, 0, 60, 60], [40, 40, 60, 60]]);
    // Two visible corners remain, top-right and bottom-left, 40×40 each.
    expect(clip).toContain("M60 0h40v40h-40Z");
    expect(clip).toContain("M0 60h40v40h-40Z");
  });
  it("hides everything when fully covered", () => {
    expect(clipPathFor(10, 10, [[-5, -5, 30, 30]])).toBe("inset(50%)");
  });
});

describe("updateClips", () => {
  function node(x: number, y: number, w: number, h: number): ClipNode & { graph: { _nodes: ClipNode[] } | null } {
    return { pos: [x, y], size: [w, h], graph: null, getBounding: () => [x, y - 30, w, h + 30] };
  }
  function setup() {
    const below = node(0, 30, 200, 100);
    const above = node(150, 30, 200, 100);
    const graph = { _nodes: [below, above] };
    below.graph = graph;
    above.graph = graph;
    const el = document.createElement("div");
    document.body.appendChild(el);
    // The widget sits at screen (0, 30), 200×100, at scale 1.
    Object.defineProperty(el, "offsetWidth", { value: 200 });
    Object.defineProperty(el, "offsetHeight", { value: 100 });
    el.getBoundingClientRect = () => ({ left: 0, top: 30, width: 200, height: 100, right: 200, bottom: 130, x: 0, y: 30, toJSON: () => ({}) });
    const canvasEl = document.createElement("canvas");
    canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) });
    const canvas = { canvas: canvasEl, ds: { offset: [0, 0], scale: 1 } };
    return { below, above, graph, el, canvas };
  }

  it("cuts out a node drawn after the widget's node", () => {
    const { below, el, canvas } = setup();
    registerOverlapClip(below, el);
    updateClips(canvas);
    expect(el.style.clipPath).toBe('path("M0 0h150v100h-150Z")');
  });

  it("leaves the widget whole when its node is on top", () => {
    const { below, above, graph, el, canvas } = setup();
    graph._nodes = [above, below];
    registerOverlapClip(below, el);
    updateClips(canvas);
    expect(el.style.clipPath).toBe("");
  });

  it("clears the clip when unregistered", () => {
    const { below, el, canvas } = setup();
    const off = registerOverlapClip(below, el);
    updateClips(canvas);
    off();
    expect(el.style.clipPath).toBe("");
  });
});
