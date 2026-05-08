import { describe, it, expect } from "vitest";
import { effectiveWeight, isEnabled, probabilityFor } from "./probability";

interface Opt { id: string; weight?: number; sub_category?: string }
type Instance = {
  enabled_options?: string[] | null;
  option_weights?: Record<string, number> | null;
  category_filter?: string[] | null;
};

describe("probability helpers", () => {
  describe("isEnabled", () => {
    it("returns true when enabled_options is null (library default = all enabled)", () => {
      expect(isEnabled({ id: "o1" }, {})).toBe(true);
    });

    it("returns true when option id is in enabled_options array", () => {
      expect(isEnabled({ id: "o1" }, { enabled_options: ["o1", "o2"] })).toBe(true);
    });

    it("returns false when option id is NOT in enabled_options array", () => {
      expect(isEnabled({ id: "o3" }, { enabled_options: ["o1", "o2"] })).toBe(false);
    });

    it("returns false when sub_category is filtered out", () => {
      expect(isEnabled({ id: "o1", sub_category: "neutral" }, { category_filter: ["warm", "cool"] })).toBe(false);
    });

    it("returns true when sub_category is in category_filter", () => {
      expect(isEnabled({ id: "o1", sub_category: "warm" }, { category_filter: ["warm", "cool"] })).toBe(true);
    });

    it("ignores category_filter when it is null", () => {
      expect(isEnabled({ id: "o1", sub_category: "neutral" }, { category_filter: null })).toBe(true);
    });
  });

  describe("effectiveWeight", () => {
    it("returns library default when no override", () => {
      expect(effectiveWeight({ id: "o1", weight: 2.5 }, {})).toBe(2.5);
    });

    it("returns instance override when present", () => {
      expect(effectiveWeight({ id: "o1", weight: 1 }, { option_weights: { o1: 1.8 } })).toBe(1.8);
    });

    it("falls back to 1.0 when neither library weight nor override is set", () => {
      expect(effectiveWeight({ id: "o1" }, {})).toBe(1.0);
    });
  });

  describe("probabilityFor", () => {
    const opts: Opt[] = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ];

    it("uniform weights, all enabled → equal probability", () => {
      expect(probabilityFor(opts[0], opts, {})).toBeCloseTo(0.333, 2);
    });

    it("disabled option → 0", () => {
      expect(probabilityFor(opts[2], opts, { enabled_options: ["a", "b"] })).toBe(0);
    });

    it("skewed weight gets higher probability", () => {
      const inst: Instance = { option_weights: { a: 2 } };
      // total enabled weight = 2 + 1 + 1 = 4. a gets 2/4 = 0.5.
      expect(probabilityFor(opts[0], opts, inst)).toBeCloseTo(0.5, 2);
      expect(probabilityFor(opts[1], opts, inst)).toBeCloseTo(0.25, 2);
    });

    it("single option enabled → probability 1.0 (effectively pinned)", () => {
      expect(probabilityFor(opts[0], opts, { enabled_options: ["a"] })).toBe(1.0);
    });

    it("all disabled → all probabilities 0", () => {
      expect(probabilityFor(opts[0], opts, { enabled_options: [] })).toBe(0);
    });

    it("category filter excludes options from totals", () => {
      const catOpts: Opt[] = [
        { id: "a", weight: 1, sub_category: "warm" },
        { id: "b", weight: 1, sub_category: "warm" },
        { id: "c", weight: 1, sub_category: "cool" },
      ];
      // category_filter: ["warm"] → only a and b count. each gets 1/2 = 0.5.
      expect(probabilityFor(catOpts[0], catOpts, { category_filter: ["warm"] })).toBeCloseTo(0.5, 2);
      expect(probabilityFor(catOpts[2], catOpts, { category_filter: ["warm"] })).toBe(0);
    });
  });
});
