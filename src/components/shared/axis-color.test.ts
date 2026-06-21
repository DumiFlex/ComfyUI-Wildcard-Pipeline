import { describe, expect, it } from "vitest";
import { axisHueAt, UNGROUPED_HUE } from "./axis-color";

describe("axisHueAt", () => {
  it("returns the neutral hue for ungrouped tags", () => {
    expect(axisHueAt(-1)).toBe(UNGROUPED_HUE);
  });

  it("gives every group a distinct colour — no two axes share a hue", () => {
    const hues = Array.from({ length: 24 }, (_, i) => axisHueAt(i));
    expect(new Set(hues).size).toBe(24);
  });

  it("has no duplicate in the curated palette (the old two-purples bug)", () => {
    const curated = Array.from({ length: 8 }, (_, i) => axisHueAt(i));
    expect(new Set(curated).size).toBe(curated.length);
    // The legacy violet that collided with purple must be gone.
    expect(curated).not.toContain("var(--wp-accent2, #a970ff)");
  });

  it("generates an hsl hue past the curated palette", () => {
    expect(axisHueAt(8)).toMatch(/^hsl\(/);
  });
});
