import { describe, it, expect } from "vitest";
import {
  producerBadge,
  producerLine,
  refRows,
  varRows,
  type ProducerLike,
} from "../suggestion-rows";

describe("refRows", () => {
  const src = {
    uuidToName: new Map([["aabbccdd", "Hair Color"]]),
    uuidToOptionsCount: new Map([["aabbccdd", 132]]),
    uuidToSubCategories: new Map([["aabbccdd", Array.from({ length: 30 }, (_, i) => `t${i}`)]]),
    uuidToTagGroups: new Map([["aabbccdd", { temperature: [], saturation: [], hue: [], tone: [], suitability: [] }]]),
  };

  it("reports the facts that separate same-named wildcards", () => {
    const [row] = refRows(["aabbccdd"], src);
    expect(row.label).toBe("Hair Color");
    expect(row.facts).toEqual(["132 options", "5 axes", "30 tags"]);
  });

  it("keeps the uuid as the last-resort tiebreaker", () => {
    expect(refRows(["aabbccdd"], src)[0].uuid).toBe("aabbccdd");
  });

  it("falls back to the uuid when no name is known", () => {
    expect(refRows(["ffffffff"], src)[0].label).toBe("ffffffff");
  });

  it("OMITS a fact rather than reporting zero — absent and empty read differently", () => {
    const [row] = refRows(["zz"], { uuidToOptionsCount: new Map([["zz", 4]]) });
    expect(row.facts).toEqual(["4 options"]);
  });

  it("singularises, including the irregular axis/axes", () => {
    const [row] = refRows(["x"], {
      uuidToOptionsCount: new Map([["x", 1]]),
      uuidToTagGroups: new Map([["x", { only: [] }]]),
      uuidToSubCategories: new Map([["x", ["solo"]]]),
    });
    expect(row.facts).toEqual(["1 option", "1 axis", "1 tag"]);
  });

  it("marks a wildcard filterable only when it declares tags", () => {
    expect(refRows(["aabbccdd"], src)[0].filterable).toBe(true);
    expect(refRows(["zz"], { uuidToOptionsCount: new Map([["zz", 4]]) })[0].filterable).toBe(false);
  });

  it("survives a surface that threads no maps at all", () => {
    const [row] = refRows(["bare"], {});
    expect(row.label).toBe("bare");
    expect(row.facts).toEqual([]);
  });
});

describe("producerLine", () => {
  const base: ProducerLike = { kind: "wildcard", shadowed: 0 };

  it("names the module and its node on a graph-aware host", () => {
    expect(producerLine({ ...base, moduleName: "Style FX", nodeLabel: "ember-marten" }, true))
      .toBe("written by Style FX · ember-marten");
  });

  it("names the module and its kind where there is no graph", () => {
    expect(producerLine({ ...base, moduleName: "Style FX", nodeLabel: "ember-marten" }, false))
      .toBe("bound by Style FX · wildcard");
  });

  it("degrades to the node alone when no module owns the write", () => {
    // Injector rows and loop iteration vars have a node but no module.
    expect(producerLine({ kind: "loop", shadowed: 0, nodeLabel: "loop-head" }, true))
      .toBe("written by loop-head");
  });

  it("degrades to the bare kind rather than a dangling verb", () => {
    expect(producerLine({ kind: "combine", shadowed: 0 }, false)).toBe("combine");
  });

  it("returns undefined when there is genuinely nothing to say", () => {
    expect(producerLine({ kind: "", shadowed: 0 }, true)).toBeUndefined();
  });
});

describe("producerBadge", () => {
  it("reads as an override where an execution order exists", () => {
    expect(producerBadge({ kind: "wildcard", shadowed: 2 })).toBe("overrides 2");
  });

  it("reads as co-binding where none does — nothing was overridden", () => {
    expect(producerBadge({ kind: "wildcard", shadowed: 2, siblingLabel: "module" }))
      .toBe("2 others bind this");
  });

  it("is absent when nothing else touches the name", () => {
    expect(producerBadge({ kind: "wildcard", shadowed: 0 })).toBeUndefined();
  });
});

describe("varRows", () => {
  it("carries the writer and the override count", () => {
    const producers = new Map<string, ProducerLike>([
      ["style_fx", { kind: "wildcard", moduleName: "Style FX", nodeLabel: "ember-marten", shadowed: 2 }],
    ]);
    const [row] = varRows(["style_fx"], producers, true);
    expect(row.producer).toBe("written by Style FX · ember-marten");
    expect(row.badge).toBe("overrides 2");
  });

  it("still yields a row, and a glyph, for a var with no known producer", () => {
    // The icon column must not go ragged just because one var is unattributed.
    const [row] = varRows(["mystery"], new Map(), true);
    expect(row.label).toBe("mystery");
    expect(row.icon).toContain("pi-");
    expect(row.producer).toBeUndefined();
  });

  it("flags an internal var, which resolves but is stripped from the prompt", () => {
    const producers = new Map<string, ProducerLike>([
      ["hidden", { kind: "combine", shadowed: 0, internal: true }],
    ]);
    expect(varRows(["hidden"], producers, true)[0].internal).toBe(true);
  });

  it("works with no producer map at all — the SPA passes none", () => {
    expect(varRows(["a", "b"], undefined, false)).toHaveLength(2);
  });
});
