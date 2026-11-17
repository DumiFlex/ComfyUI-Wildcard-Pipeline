import { describe, expect, it } from "vitest";
import { aspectOf, cellAspect, cellBox, containSize, mixedSizes, sizeText } from "./picker-sizes";

const sq = { width: 1024, height: 1024 };
const tall = { width: 832, height: 1216 };
const wide = { width: 1216, height: 832 };

describe("picker sizes", () => {
  it("the cell shape is the one most pictures share", () => {
    expect(cellAspect([tall, tall, sq, wide])).toBeCloseTo(1216 / 832);
    // A 512 draft and a 1024 upscale are the same shape.
    expect(cellAspect([{ width: 512, height: 768 }, { width: 1024, height: 1536 }, sq])).toBeCloseTo(1.5);
  });

  it("ties go to the squarest; unknown sizes don't vote", () => {
    expect(cellAspect([tall, wide, sq])).toBe(1);
    // Equally square: the first one seen.
    expect(cellAspect([tall, wide])).toBeCloseTo(1216 / 832);
    expect(cellAspect([null, undefined, { width: 0, height: 0 }])).toBe(1);
    expect(cellAspect([null, tall])).toBeCloseTo(1216 / 832);
  });

  it("tells a run that mixes sizes", () => {
    expect(mixedSizes([sq, sq, null])).toBe(false);
    expect(mixedSizes([sq, { width: 512, height: 512 }])).toBe(true);
    expect(mixedSizes([])).toBe(false);
  });

  it("boxes and fits", () => {
    expect(cellBox(200, 1.5)).toEqual({ width: 133, height: 200 });
    expect(cellBox(200, 0.5)).toEqual({ width: 200, height: 100 });
    expect(cellBox(200, Number.NaN)).toEqual({ width: 200, height: 200 });
    // Scales a small picture up and a big one down.
    expect(containSize({ width: 512, height: 512 }, { width: 800, height: 600 })).toEqual({ width: 600, height: 600 });
    expect(containSize(wide, { width: 608, height: 1000 })).toEqual({ width: 608, height: 416 });
    expect(containSize(sq, { width: 0, height: 10 })).toEqual({ width: 0, height: 0 });
    expect(aspectOf(tall)).toBeCloseTo(1216 / 832);
    expect(aspectOf(null)).toBe(1);
    expect(sizeText(tall)).toBe("832 × 1216");
    expect(sizeText(undefined)).toBe("");
  });
});
