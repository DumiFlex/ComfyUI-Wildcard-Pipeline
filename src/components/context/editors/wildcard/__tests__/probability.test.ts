import { describe, it, expect } from "vitest";
import {
  effectiveWeight,
  isEnabled,
  probabilityFor,
  type InstanceLike,
  type WildcardOption,
} from "../probability";

const opt = (sc: string[], extra: Partial<WildcardOption> = {}): WildcardOption => ({
  id: "o",
  weight: 1,
  sub_categories: sc,
  ...extra,
});

describe("isEnabled multi-tag", () => {
  it("matches the boolean category_filter expression (any/and/not)", () => {
    expect(isEnabled(opt(["warm"]), { category_filter: "warm or cold" })).toBe(true);
    expect(isEnabled(opt(["warm"]), { category_filter: "warm and cold" })).toBe(false);
    expect(isEnabled(opt(["warm"]), { category_filter: "" })).toBe(true);
    expect(isEnabled(opt([]), { category_filter: "not cold" })).toBe(true);
  });

  it("null option governed by exclude_null", () => {
    const nul = { id: "n", value: "", weight: 1, is_null: true, sub_categories: [] };
    expect(isEnabled(nul, { category_filter: "warm", exclude_null: false })).toBe(true);
    expect(isEnabled(nul, { exclude_null: true })).toBe(false);
  });

  it("null option ignores enabled_options — only exclude_null gates it (#3)", () => {
    const nul = { id: "n", value: "", weight: 1, is_null: true, sub_categories: [] };
    // enabled_options excludes the null id, but the null slot is orthogonal:
    // it stays enabled while exclude_null is false, and only drops when set.
    expect(isEnabled(nul, { enabled_options: ["other"], exclude_null: false })).toBe(true);
    expect(isEnabled(nul, { enabled_options: ["other"], exclude_null: true })).toBe(false);
  });

  it("matches a multi-tag option against an AND across axes", () => {
    // Option carries both tags → satisfies "feline and warm".
    expect(isEnabled(opt(["feline", "warm"]), { category_filter: "feline and warm" })).toBe(true);
    // Option missing one of the AND'd tags → excluded.
    expect(isEnabled(opt(["feline", "cold"]), { category_filter: "feline and warm" })).toBe(false);
  });

  it("returns true when category_filter is absent (library default = no filter)", () => {
    expect(isEnabled(opt(["warm"]), {})).toBe(true);
    expect(isEnabled(opt([]), {})).toBe(true);
  });

  it("returns true when category_filter is null", () => {
    expect(isEnabled(opt(["neutral"]), { category_filter: null })).toBe(true);
  });

  it("combines with enabled_options (intersection)", () => {
    expect(
      isEnabled(opt(["warm"], { id: "o1" }), {
        enabled_options: ["o2"],
        category_filter: "warm",
      }),
    ).toBe(false);
    expect(
      isEnabled(opt(["warm"], { id: "o1" }), {
        enabled_options: ["o1"],
        category_filter: "warm",
      }),
    ).toBe(true);
  });

  it("returns false when option id is NOT in enabled_options array", () => {
    expect(isEnabled(opt(["warm"], { id: "o3" }), { enabled_options: ["o1", "o2"] })).toBe(false);
  });

  it("null option stays in the pool under a category_filter (exclude_null governs it)", () => {
    const nul = { id: "n", value: "", weight: 1, is_null: true, sub_categories: [] };
    // A sub-cat filter doesn't strip the null slot — only exclude_null does.
    expect(isEnabled(nul, { category_filter: "warm and cold" })).toBe(true);
  });
});

describe("effectiveWeight", () => {
  it("returns library default when no override", () => {
    expect(effectiveWeight(opt([], { weight: 2.5 }), {})).toBe(2.5);
  });

  it("returns instance override when present", () => {
    expect(effectiveWeight(opt([], { id: "o1", weight: 1 }), { option_weights: { o1: 1.8 } })).toBe(1.8);
  });

  it("falls back to 1.0 when neither library weight nor override is set", () => {
    expect(effectiveWeight({ id: "o1", sub_categories: [] }, {})).toBe(1.0);
  });
});

describe("probabilityFor", () => {
  const opts: WildcardOption[] = [
    { id: "a", weight: 1, sub_categories: [] },
    { id: "b", weight: 1, sub_categories: [] },
    { id: "c", weight: 1, sub_categories: [] },
  ];

  it("uniform weights, all enabled → equal probability", () => {
    expect(probabilityFor(opts[0], opts, {})).toBeCloseTo(0.333, 2);
  });

  it("disabled option → 0", () => {
    expect(probabilityFor(opts[2], opts, { enabled_options: ["a", "b"] })).toBe(0);
  });

  it("skewed weight gets higher probability", () => {
    const inst: InstanceLike = { option_weights: { a: 2 } };
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
    const catOpts: WildcardOption[] = [
      { id: "a", weight: 1, sub_categories: ["warm"] },
      { id: "b", weight: 1, sub_categories: ["warm"] },
      { id: "c", weight: 1, sub_categories: ["cool"] },
    ];
    // category_filter: "warm" → only a and b count. each gets 1/2 = 0.5.
    expect(probabilityFor(catOpts[0], catOpts, { category_filter: "warm" })).toBeCloseTo(0.5, 2);
    expect(probabilityFor(catOpts[2], catOpts, { category_filter: "warm" })).toBe(0);
  });
});
