import { describe, expect, it } from "vitest";
import {
  hugTrigger, PICKER_APPROX_H, PICKER_W, pickerAnchorFor, POPUP_H, popupPlacement, shouldFlipAbove,
} from "./popup-geometry";

const vp = { width: 1000, height: 800 };

describe("popupPlacement", () => {
  it("sits below with a minimum width", () => {
    expect(popupPlacement({ top: 100, bottom: 120, left: 10, width: 150 }, vp))
      .toEqual({ top: 124, left: 10, width: 200, flipped: false });
  });

  it("flips above when there is no room below", () => {
    const r = popupPlacement({ top: 700, bottom: 720, left: 0, width: 300 }, vp);
    expect(r).toEqual({ top: 696, left: 0, width: 300, flipped: true });
    expect(800 - 720).toBeLessThan(POPUP_H);
  });
});

describe("pickerAnchorFor", () => {
  it("anchors below and clamps to the right edge", () => {
    expect(pickerAnchorFor({ top: 50, bottom: 70, left: 900 }, vp))
      .toEqual({ top: 76, left: vp.width - PICKER_W - 8, flipped: false });
  });

  it("flips above near the bottom and keeps the top on-screen", () => {
    const r = pickerAnchorFor({ top: 600, bottom: 620, left: 0 }, vp);
    expect(r.flipped).toBe(true);
    expect(r.left).toBe(8);
    expect(r.top).toBe(600 - PICKER_APPROX_H - 6);
  });
});

describe("hugTrigger", () => {
  it("hugs below or above with a 6px gap", () => {
    expect(hugTrigger({ top: 100, bottom: 120 }, { width: 200, height: 50 }, false, 30, vp))
      .toEqual({ top: 126, left: 30 });
    expect(hugTrigger({ top: 100, bottom: 120 }, { width: 200, height: 50 }, true, 30, vp))
      .toEqual({ top: 44, left: 30 });
  });

  it("clamps into the viewport, but not on an unmeasured axis", () => {
    expect(hugTrigger({ top: 10, bottom: 20 }, { width: 300, height: 100 }, true, 900, vp))
      .toEqual({ top: 8, left: 692 });
    expect(hugTrigger({ top: 10, bottom: 20 }, { width: 0, height: 0 }, true, 900, vp))
      .toEqual({ top: 4, left: 900 });
  });
});

describe("shouldFlipAbove", () => {
  it("flips only when the box does not fit below and above is roomier", () => {
    expect(shouldFlipAbove({ top: 700, bottom: 720 }, 200, 800)).toBe(true);
    expect(shouldFlipAbove({ top: 100, bottom: 120 }, 200, 800)).toBe(false);
    expect(shouldFlipAbove({ top: 700, bottom: 720 }, 0, 800)).toBe(false);
  });
});
