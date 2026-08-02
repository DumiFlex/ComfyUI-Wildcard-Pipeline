import { describe, it, expect } from "vitest";
import {
  producerBadge,
  producerParts,
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

  it("carries the kind, so the icon can take that kind's colour", () => {
    const [row] = refRows(["aabbccdd"], src);
    expect(row.kind).toBe("wildcard");
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

describe("producerParts", () => {
  const base: ProducerLike = { kind: "wildcard", shadowed: 0 };

  it("names the module and its node on a graph-aware host", () => {
    expect(producerParts({ ...base, moduleName: "Style FX", nodeLabel: "ember-marten" }, true))
      .toEqual({ verb: "written by", moduleName: "Style FX", tail: "ember-marten" });
  });

  it("names the module and its kind where there is no graph", () => {
    expect(producerParts({ ...base, moduleName: "Style FX", nodeLabel: "ember-marten" }, false))
      .toEqual({ verb: "bound by", moduleName: "Style FX", tail: "wildcard" });
  });

  it("keeps the module name SEPARATE so it can be highlighted", () => {
    // Pre-joining it into one sentence is what made the identifying half of
    // the line impossible to pick out.
    const parts = producerParts({ ...base, moduleName: "Style FX" }, true);
    expect(parts?.moduleName).toBe("Style FX");
  });

  it("promotes the node to the highlighted slot when no module owns the write", () => {
    // Injector rows and loop iteration vars have a node but no module, and the
    // node is then the identifying half.
    expect(producerParts({ kind: "loop", shadowed: 0, nodeLabel: "loop-head" }, true))
      .toEqual({ verb: "written by", moduleName: "loop-head" });
  });

  it("degrades to the bare kind rather than a dangling verb", () => {
    expect(producerParts({ kind: "combine", shadowed: 0 }, false))
      .toEqual({ verb: "", tail: "combine" });
  });

  it("returns undefined when there is genuinely nothing to say", () => {
    expect(producerParts({ kind: "", shadowed: 0 }, true)).toBeUndefined();
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
    expect(row.producer).toEqual({
      verb: "written by", moduleName: "Style FX", tail: "ember-marten",
    });
    expect(row.badge).toBe("overrides 2");
  });

  it("still yields a row, and a glyph, for a var with no known producer", () => {
    // The icon column must not go ragged just because one var is unattributed.
    const [row] = varRows(["mystery"], new Map(), true);
    expect(row.label).toBe("mystery");
    expect(row.icon).toContain("pi-");
    expect(row.producer).toBeUndefined();
  });

  it("takes its kind from the PRODUCER, not from a fixed wildcard default", () => {
    // A `$var` written by a fixed_values must not be painted wildcard-violet.
    const producers = new Map<string, ProducerLike>([
      ["ref", { kind: "fixed_values", shadowed: 0 }],
    ]);
    expect(varRows(["ref"], producers, true)[0].kind).toBe("fixed_values");
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
