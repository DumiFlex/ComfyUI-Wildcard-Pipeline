import { describe, expect, it } from "vitest";
import { varColorClass, varColorIndex, VAR_COLOR_COUNT } from "./var-color";

describe("var-color", () => {
  it("produces a deterministic class per binding name", () => {
    expect(varColorClass("hair_style")).toBe(varColorClass("hair_style"));
    expect(varColorClass("mood")).toBe(varColorClass("mood"));
  });

  it("class names follow the var-N convention", () => {
    const cls = varColorClass("anything");
    expect(cls).toMatch(/^var-[1-8]$/);
  });

  it("VAR_COLOR_COUNT is 8 (matches palette width)", () => {
    expect(VAR_COLOR_COUNT).toBe(8);
  });

  it("varColorIndex returns 1..8 for any non-empty string", () => {
    for (const sample of ["a", "hair_style", "very_long_variable_name", "$$weird"]) {
      const i = varColorIndex(sample);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(8);
    }
  });

  it("empty string maps to index 1 (deterministic fallback)", () => {
    expect(varColorIndex("")).toBe(1);
    expect(varColorClass("")).toBe("var-1");
  });
});
