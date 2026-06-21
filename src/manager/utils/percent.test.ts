import { describe, expect, it } from "vitest";
import { formatProbability } from "./percent";

describe("formatProbability", () => {
  it("renders zero / non-finite as 0%", () => {
    expect(formatProbability(0)).toBe("0%");
    expect(formatProbability(-1)).toBe("0%");
    expect(formatProbability(NaN)).toBe("0%");
  });

  it("rounds large values to integers", () => {
    expect(formatProbability(33.333)).toBe("33%");
    expect(formatProbability(100)).toBe("100%");
    expect(formatProbability(10)).toBe("10%");
  });

  it("shows one trimmed decimal in the 1–10% band", () => {
    expect(formatProbability(2.5)).toBe("2.5%");
    expect(formatProbability(5)).toBe("5%"); // 5.0 → trimmed
    expect(formatProbability(1)).toBe("1%");
  });

  it("never collapses a nonzero sub-1% probability to 0%", () => {
    expect(formatProbability(0.76)).toBe("0.76%");
    expect(formatProbability(0.01)).toBe("0.01%");
    expect(formatProbability(0.0076)).toBe("0.01%"); // 2dp rounding
    expect(formatProbability(0.001)).toBe("0.001%"); // grows to 3dp
    expect(formatProbability(0.5)).toBe("0.5%");
  });

  it("falls back to <0.01% for vanishingly small probabilities", () => {
    expect(formatProbability(0.000001)).toBe("<0.01%");
  });
});
