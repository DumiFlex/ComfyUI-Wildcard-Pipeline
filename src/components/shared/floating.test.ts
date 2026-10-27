import { describe, expect, it } from "vitest";
import { placeFloating, splitPlacement } from "./floating";

const view = { width: 1000, height: 800 };
const panel = { width: 200, height: 100 };

describe("placeFloating", () => {
  it("puts the panel under the anchor, lined up with its left edge", () => {
    const at = placeFloating({ left: 100, top: 100, width: 80, height: 30 }, panel, view);
    expect(at).toEqual({ x: 100, y: 136, side: "bottom" });
  });

  it("flips above when there is no room below", () => {
    const at = placeFloating({ left: 100, top: 740, width: 80, height: 30 }, panel, view);
    expect(at.side).toBe("top");
    expect(at.y).toBe(740 - 6 - 100);
  });

  it("stays put when the other side has even less room", () => {
    const at = placeFloating({ left: 100, top: 10, width: 80, height: 760 }, panel, view, { placement: "bottom" });
    expect(at.side).toBe("bottom");
    expect(at.y).toBe(800 - 8 - 100);
  });

  it("keeps the panel inside the viewport on the right edge", () => {
    const at = placeFloating({ left: 950, top: 100, width: 40, height: 30 }, panel, view);
    expect(at.x).toBe(1000 - 8 - 200);
  });

  it("lines up end and centre", () => {
    const a = { left: 300, top: 100, width: 100, height: 20 };
    expect(placeFloating(a, panel, view, { placement: "bottom-end" }).x).toBe(200);
    expect(placeFloating(a, panel, view, { placement: "top" }).x).toBe(250);
  });

  it("places beside the anchor and flips left at the edge", () => {
    expect(placeFloating({ left: 100, top: 100, width: 50, height: 20 }, panel, view, { placement: "right-start" }))
      .toEqual({ x: 156, y: 100, side: "right" });
    expect(placeFloating({ left: 900, top: 100, width: 50, height: 20 }, panel, view, { placement: "right-start" }).side)
      .toBe("left");
  });

  it("treats a point as a zero-size anchor (right-click menus)", () => {
    expect(placeFloating({ left: 980, top: 790, width: 0, height: 0 }, panel, view, { gap: 0 }))
      .toEqual({ x: 792, y: 690, side: "top" });
  });
});

describe("splitPlacement", () => {
  it("defaults the alignment to centre", () => {
    expect(splitPlacement("top")).toEqual({ side: "top", align: "center" });
    expect(splitPlacement("left-end")).toEqual({ side: "left", align: "end" });
  });
});
