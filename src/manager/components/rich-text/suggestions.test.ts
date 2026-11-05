import { describe, expect, it } from "vitest";
import type { ProducerLike } from "../../utils/suggestion-rows";
import {
  AC_MAX_ITEMS, axisKnownFor, kindTint, matchSuggestions, placeholderNameFor,
  varSpanAttrsFor, varTint,
} from "./suggestions";

const producer = (axes: string[] = []): ProducerLike => ({
  kind: "wildcard",
  shadowed: 0,
  axes: axes.map((axis, hueIndex) => ({ axis, tags: [], hueIndex })),
});

const base = {
  varSuggestions: ["outfit", "mood"],
  refSuggestions: ["aaaa1111", "bbbb2222"],
  uuidToName: new Map([["aaaa1111", "Color"], ["bbbb2222", "pose"]]),
  varProducers: new Map([["outfit", producer(["SHOES", "HAT"])]]),
};

describe("matchSuggestions", () => {
  const match = (
    q: { trigger: "$" | "@"; query: string; uuidToName?: ReadonlyMap<string, string> },
  ): string[] => matchSuggestions(
    q.trigger, q.query, base.varSuggestions, base.refSuggestions,
    q.uuidToName ?? base.uuidToName, base.varProducers,
  );

  it("matches @ refs by display name", () => {
    expect(match({ trigger: "@", query: "col" })).toEqual(["aaaa1111"]);
  });

  it("falls back to the uuid when unnamed", () => {
    expect(match({ uuidToName: new Map(), trigger: "@", query: "bbbb" }))
      .toEqual(["bbbb2222"]);
  });

  it("offers $ vars with their axes", () => {
    expect(match({ trigger: "$", query: "out" }))
      .toEqual(["outfit", "outfit.SHOES", "outfit.HAT"]);
  });

  it("switches to axes once the query carries a dot, keeping a pick index", () => {
    expect(match({ trigger: "$", query: "outfit.sh" })).toEqual(["outfit.SHOES"]);
    expect(match({ trigger: "$", query: "outfit.0.ha" }))
      .toEqual(["outfit.0.HAT"]);
    expect(match({ trigger: "$", query: "outfit." }))
      .toEqual(["outfit.SHOES", "outfit.HAT", "outfit.neg"]);
  });

  it("offers .neg for a known variable without axes, not for an unknown one", () => {
    expect(match({ trigger: "$", query: "mood.n" })).toEqual(["mood.neg"]);
    expect(match({ trigger: "$", query: "nope.n" })).toEqual([]);
  });

  it("exposes the row cap", () => {
    expect(AC_MAX_ITEMS).toBe(50);
  });
});

describe("placeholderNameFor", () => {
  it("offers a plain identifier nothing is called", () => {
    expect(placeholderNameFor("newthing", base.uuidToName)).toBe("newthing");
  });

  it("refuses existing names (case-insensitive) and non-identifiers", () => {
    expect(placeholderNameFor("COLOR", base.uuidToName)).toBeNull();
    expect(placeholderNameFor("9x", base.uuidToName)).toBeNull();
    expect(placeholderNameFor("", base.uuidToName)).toBeNull();
  });
});

describe("kindTint / varTint", () => {
  it("maps fixed_values to the fixed token with an accent fallback", () => {
    expect(kindTint("fixed_values").color).toBe("var(--wp-kind-fixed, var(--wp-accent-text, #a5b4fc))");
    expect(kindTint("wildcard").background).toContain("--wp-kind-wildcard");
  });

  it("tints a var by its name hash", () => {
    expect(varTint("mood").color).toMatch(/^var\(--wp-var-\d+\)$/);
    expect(varTint("mood")).toEqual(varTint("mood"));
  });
});

describe("axisKnownFor", () => {
  const map = new Map([["outfit", producer(["SHOES"])], ["bare", producer()]]);

  it("is undefined for non-axis atoms and unknowable producers", () => {
    expect(axisKnownFor({ kind: "text", text: "x" }, map)).toBeUndefined();
    expect(axisKnownFor({ kind: "var", name: "outfit" }, map)).toBeUndefined();
    expect(axisKnownFor({ kind: "var", name: "bare", axis: "X" }, map)).toBeUndefined();
    expect(axisKnownFor({ kind: "var", name: "outfit", axis: "X" }, undefined)).toBeUndefined();
  });

  it("knows .neg always and checks declared axes", () => {
    expect(axisKnownFor({ kind: "var", name: "nope", axis: "neg" }, map)).toBe(true);
    expect(axisKnownFor({ kind: "var", name: "outfit", axis: "SHOES" }, map)).toBe(true);
    expect(axisKnownFor({ kind: "var", name: "outfit", axis: "HAT" }, map)).toBe(false);
  });
});

describe("varSpanAttrsFor", () => {
  const attrs = (name: string, graphAware = true): string =>
    varSpanAttrsFor(name, graphAware, ["outfit"], base.varProducers);

  it("colours a known var by its base name", () => {
    expect(attrs("outfit.SHOES")).toMatch(/color:var\(--wp-var-\d+\)/);
    expect(attrs("outfit.0.SHOES")).toMatch(/--wp-var-/);
    expect(attrs("outfit.neg")).toMatch(/--wp-var-/);
  });

  it("warns on an undeclared axis and flags an unknown var", () => {
    expect(attrs("outfit.NOPE")).toContain("--wp-warn");
    expect(attrs("ghost")).toContain("--wp-danger");
  });

  it("stays quiet without a graph", () => {
    expect(attrs("ghost", false)).toMatch(/--wp-var-/);
  });
});
