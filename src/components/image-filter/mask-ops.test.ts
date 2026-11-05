import { describe, expect, it } from "vitest";
import {
  brushCover, composite, copyBuf, feather, floodFill, fullRect, invertBuf, isBlank, makeBuf, MaskHistory, polygon,
  segment, stamp, unionRect,
} from "./mask-ops";

const at = (b: { width: number; data: Uint8ClampedArray }, x: number, y: number) => b.data[y * b.width + x];

describe("mask ops", () => {
  it("a hard brush is solid to its rim; a soft one fades from where its hardness ends", () => {
    expect(brushCover(0, 10, 1)).toBe(1);
    expect(brushCover(9, 10, 1)).toBe(1);
    expect(brushCover(10, 10, 1)).toBeCloseTo(0.5);
    expect(brushCover(11, 10, 1)).toBe(0);
    expect(brushCover(4, 10, 0.5)).toBe(1);
    const mid = brushCover(7.5, 10, 0.5);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(brushCover(10, 10, 0.5)).toBe(0);
    expect(brushCover(3, 0, 1)).toBe(0);
  });

  it("stamps take the max, so a stroke crossing itself stays at one strength", () => {
    const cover = makeBuf(40, 40);
    segment(cover, 5, 20, 35, 20, 4, 1);
    segment(cover, 20, 5, 20, 35, 4, 1);
    const base = makeBuf(40, 40);
    const out = makeBuf(40, 40);
    composite(base, cover, out, fullRect(base), 0.5, false);
    // Where the two lines cross is no darker than either line alone.
    expect(at(out, 20, 20)).toBe(at(out, 10, 20));
    expect(at(out, 10, 20)).toBe(128);
    expect(at(out, 2, 2)).toBe(0);
  });

  it("paint goes over what is there and erase takes away, at the strength", () => {
    const base = makeBuf(4, 1);
    base.data.set([0, 100, 200, 255]);
    const cover = makeBuf(4, 1);
    cover.data.fill(255);
    const out = makeBuf(4, 1);
    composite(base, cover, out, fullRect(base), 0.5, false);
    expect([...out.data]).toEqual([128, 178, 228, 255]);
    composite(base, cover, out, fullRect(base), 0.5, true);
    expect([...out.data]).toEqual([0, 50, 100, 128]);
  });

  it("a stamp off the edge touches only what is inside", () => {
    const cover = makeBuf(10, 10);
    expect(stamp(cover, -50, -50, 5, 1)).toBeNull();
    const r = stamp(cover, 0, 0, 3, 1);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 5, y1: 5 });
    expect(at(cover, 0, 0)).toBe(255);
  });

  it("the lasso fills the inside of its path", () => {
    const cover = makeBuf(20, 20);
    const r = polygon(cover, [{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 18 }, { x: 2, y: 18 }]);
    expect(r).not.toBeNull();
    expect(at(cover, 10, 10)).toBe(255);
    expect(at(cover, 2, 10)).toBe(255);
    expect(at(cover, 1, 10)).toBe(0);
    expect(at(cover, 18, 10)).toBe(0);
    expect(polygon(cover, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull();
  });

  it("fill takes the area under the click up to a painted outline", () => {
    const mask = makeBuf(20, 20);
    // A ring painted with the brush: a square outline from 5 to 14.
    for (let i = 5; i <= 14; i++) {
      mask.data[5 * 20 + i] = 255;
      mask.data[14 * 20 + i] = 255;
      mask.data[i * 20 + 5] = 255;
      mask.data[i * 20 + 14] = 255;
    }
    const inside = makeBuf(20, 20);
    // The inside, plus two pixels into the outline so no soft rim is left between.
    expect(floodFill(mask, inside, 9, 9)).toEqual({ x0: 4, y0: 4, x1: 16, y1: 16 });
    expect(at(inside, 9, 9)).toBe(255);
    expect(at(inside, 5, 9)).toBe(255);
    expect(at(inside, 4, 9)).toBe(255);
    expect(at(inside, 3, 9)).toBe(0);
    expect(at(inside, 2, 2)).toBe(0);
    const outside = makeBuf(20, 20);
    floodFill(mask, outside, 1, 1);
    expect(at(outside, 0, 19)).toBe(255);
    expect(at(outside, 9, 9)).toBe(0);
    expect(at(outside, 7, 9)).toBe(0);
    expect(floodFill(mask, outside, 25, 1)).toBeNull();
  });

  it("feather softens a hard edge and grows the touched box", () => {
    const cover = makeBuf(30, 30);
    const r = polygon(cover, [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]);
    expect(r).not.toBeNull();
    if (!r) return;
    const grown = feather(cover, r, 6);
    expect(grown.x0).toBeLessThan(r.x0);
    expect(at(cover, 15, 15)).toBeGreaterThan(200);
    const edge = at(cover, 10, 15);
    expect(edge).toBeGreaterThan(60);
    expect(edge).toBeLessThan(200);
    expect(at(cover, 7, 15)).toBeGreaterThan(0);
    // Under a pixel of feather is no feather.
    expect(feather(cover, r, 1)).toBe(r);
  });

  it("invert, blank, copy and rect union", () => {
    const b = makeBuf(2, 1);
    expect(isBlank(b)).toBe(true);
    invertBuf(b);
    expect([...b.data]).toEqual([255, 255]);
    expect(isBlank(b)).toBe(false);
    const c = copyBuf(b);
    c.data[0] = 0;
    expect(b.data[0]).toBe(255);
    expect(unionRect(null, { x0: 1, y0: 1, x1: 2, y1: 2 })).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 });
    expect(unionRect({ x0: 0, y0: 3, x1: 1, y1: 4 }, { x0: 1, y0: 1, x1: 2, y1: 2 })).toEqual({ x0: 0, y0: 1, x1: 2, y1: 4 });
  });

  it("history undoes and redoes whole masks, and a new change drops the redo", () => {
    const h = new MaskHistory(2);
    const m = makeBuf(1, 1);
    expect(h.undo(m)).toBe(false);
    for (const v of [10, 20, 30]) {
      h.push(m);
      m.data[0] = v;
    }
    // Only two steps are kept.
    expect(h.undo(m)).toBe(true);
    expect(m.data[0]).toBe(20);
    expect(h.undo(m)).toBe(true);
    expect(m.data[0]).toBe(10);
    expect(h.canUndo).toBe(false);
    expect(h.redo(m)).toBe(true);
    expect(m.data[0]).toBe(20);
    h.push(m);
    m.data[0] = 99;
    expect(h.canRedo).toBe(false);
    expect(h.redo(m)).toBe(false);
  });
});
