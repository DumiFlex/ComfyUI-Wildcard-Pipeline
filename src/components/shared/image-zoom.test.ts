import { describe, expect, it } from "vitest";
import { centreOf, clampView, fitScale, minScale, percent, stepScale, viewAround, visibleRect, zoomAt } from "./image-zoom";

const img = { width: 1000, height: 500 };
const stage = { width: 500, height: 500 };

describe("image zoom maths", () => {
  it("fit shows the whole picture, scaling small ones up", () => {
    expect(fitScale(img, stage)).toBe(0.5);
    expect(fitScale({ width: 100, height: 100 }, stage)).toBe(5);
    expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1);
    expect(minScale(img, stage)).toBe(0.25);
  });

  it("centres an axis that fits and never shows an empty edge on one that doesn't", () => {
    // At 0.5 the picture is 500 x 250: centred vertically.
    expect(clampView({ scale: 0.5, x: 99, y: 99 }, img, stage)).toEqual({ scale: 0.5, x: 0, y: 125 });
    // At 1 it is 1000 x 500: x stays within [-500, 0].
    expect(clampView({ scale: 1, x: 20, y: 0 }, img, stage).x).toBe(0);
    expect(clampView({ scale: 1, x: -900, y: 0 }, img, stage).x).toBe(-500);
  });

  it("zooming keeps the image point under the pointer in place", () => {
    const fit = clampView({ scale: 0.5, x: 0, y: 0 }, img, stage);
    const at = { x: 250, y: 250 };
    // Under the pointer: image point (500, 250).
    const v = zoomAt(fit, 1, at, img, stage);
    expect(v.scale).toBe(1);
    expect((at.x - v.x) / v.scale).toBeCloseTo(500);
    expect((at.y - v.y) / v.scale).toBeCloseTo(250);
    expect(zoomAt(fit, 99, at, img, stage).scale).toBe(8);
  });

  it("keeps the spot across images: centre out, view around it back in", () => {
    const v = viewAround(2, { x: 0.25, y: 0.75 }, img, stage);
    const c = centreOf(v, img, stage);
    expect(c.x).toBeCloseTo(0.25);
    expect(c.y).toBeCloseTo(0.75);
  });

  it("buttons step through fixed levels with Fit slotted in", () => {
    expect(stepScale(0.5, 1, 0.6)).toBe(0.6);
    expect(stepScale(0.6, 1, 0.6)).toBe(0.75);
    expect(stepScale(1, -1, 0.6)).toBe(0.75);
    expect(stepScale(8, 1, 0.6)).toBe(8);
    expect(stepScale(0.1, -1, 0.6)).toBe(0.1);
    expect(percent(0.756)).toBe("76%");
  });

  it("visibleRect is the part in view as fractions of the image", () => {
    // 1000 x 500 at 100% in 500 x 500, scrolled to the right half.
    expect(visibleRect({ scale: 1, x: -500, y: 0 }, img, stage)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    // Smaller than the stage: all of it.
    expect(visibleRect({ scale: 0.25, x: 125, y: 187.5 }, img, stage)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(visibleRect({ scale: 1, x: 0, y: 0 }, { width: 0, height: 0 }, stage)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
