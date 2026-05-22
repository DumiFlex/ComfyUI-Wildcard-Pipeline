import { describe, expect, it } from "vitest";
import { buildDepGraph, transitiveClosure, constraintsBothSidesIn } from "../dep-graph";
import type { RawPayload } from "../migrations";

function makePayload(parts: Partial<RawPayload>): RawPayload {
  return {
    schema_version: 1,
    bundles: parts.bundles ?? [],
    wildcards: parts.wildcards ?? [],
    fixed_values: parts.fixed_values ?? [],
    combines: parts.combines ?? [],
    derivations: parts.derivations ?? [],
    constraints: parts.constraints ?? [],
    categories: parts.categories ?? [],
  };
}

describe("buildDepGraph", () => {
  it("captures wildcard @{uuid} refs in option values as outgoing edges", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [{ value: "see @{22222222} now", weight: 1 }], tags: [] },
        { uuid: "22222222", name: "y", options: [], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["11111111"]).toContain("22222222");
    expect(graph["22222222"]).toEqual([]);
  });

  it("captures bundle children inner-bundle refs", () => {
    const payload = makePayload({
      bundles: [
        { uuid: "bbbb1111", name: "outer", children: [{ uuid: "bbbb2222", type: "bundle" }] },
        { uuid: "bbbb2222", name: "inner", children: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["bbbb1111"]).toContain("bbbb2222");
  });

  it("ignores bundle children with non-bundle type", () => {
    const payload = makePayload({
      bundles: [
        { uuid: "bbbb1111", name: "x", children: [{ uuid: "ddddffff", type: "module" }] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["bbbb1111"]).not.toContain("ddddffff");
  });

  it("captures constraint source + target as outgoing edges", () => {
    const payload = makePayload({
      constraints: [{ uuid: "cccc1111", source_uuid: "eeee1111", target_uuid: "eeee2222", op: "equals", value: "x" }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["cccc1111"]).toEqual(expect.arrayContaining(["eeee1111", "eeee2222"]));
  });

  it("fixed_values have empty edge list", () => {
    const payload = makePayload({
      fixed_values: [{ uuid: "eeee1111", name: "v1", value: "x", tags: [] }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["eeee1111"]).toEqual([]);
  });

  it("combines have empty edge list", () => {
    const payload = makePayload({
      combines: [{ uuid: "cccc1112", name: "cb1", template: "hello $x", tags: [] }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["cccc1112"]).toEqual([]);
  });

  it("derivations have empty edge list", () => {
    const payload = makePayload({
      derivations: [{ uuid: "dddd1113", name: "dr1", tags: [] }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["dddd1113"]).toEqual([]);
  });

  it("categories have empty edge list", () => {
    const payload = makePayload({
      categories: [{ uuid: "cat11111", name: "palette" }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["cat11111"]).toEqual([]);
  });

  it("dedupes multiple refs to same UUID in same wildcard", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [
          { value: "@{22222222} and @{22222222}", weight: 1 },
        ], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["11111111"]).toEqual(["22222222"]);
  });
});

describe("transitiveClosure", () => {
  it("walks outgoing refs to fixed point", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "aaaaaaaa", name: "a", options: [{ value: "@{bbbbbbbb}", weight: 1 }], tags: [] },
        { uuid: "bbbbbbbb", name: "b", options: [{ value: "@{cccccccc}", weight: 1 }], tags: [] },
        { uuid: "cccccccc", name: "c", options: [], tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["aaaaaaaa"]));
    expect(closure).toEqual(new Set(["aaaaaaaa", "bbbbbbbb", "cccccccc"]));
  });

  it("handles cycles without infinite loop", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "aaaaaaaa", name: "a", options: [{ value: "@{bbbbbbbb}", weight: 1 }], tags: [] },
        { uuid: "bbbbbbbb", name: "b", options: [{ value: "@{aaaaaaaa}", weight: 1 }], tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["aaaaaaaa"]));
    expect(closure).toEqual(new Set(["aaaaaaaa", "bbbbbbbb"]));
  });

  it("does not include reverse deps (constraints referencing a selected fixed_value)", () => {
    const payload = makePayload({
      constraints: [{ uuid: "cccc1111", source_uuid: "eeee1111", target_uuid: "eeee2222", op: "equals", value: "x" }],
      fixed_values: [
        { uuid: "eeee1111", name: "v1", value: "", tags: [] },
        { uuid: "eeee2222", name: "v2", value: "", tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["eeee1111"]));
    expect(closure.has("cccc1111")).toBe(false);
  });

  it("empty seed returns empty closure", () => {
    const payload = makePayload({
      wildcards: [{ uuid: "aaaaaaaa", name: "a", options: [], tags: [] }],
    });
    expect(transitiveClosure(payload, new Set())).toEqual(new Set());
  });
});

describe("constraintsBothSidesIn", () => {
  it("returns constraints whose source AND target are in selection", () => {
    const payload = makePayload({
      constraints: [
        { uuid: "cccc1111", source_uuid: "eeee1111", target_uuid: "eeee2222", op: "equals", value: "" },
        { uuid: "cccc2222", source_uuid: "eeee1111", target_uuid: "eeee3333", op: "equals", value: "" },
      ],
    });
    const result = constraintsBothSidesIn(payload, new Set(["eeee1111", "eeee2222"]));
    expect(result).toEqual(["cccc1111"]);
  });

  it("returns empty when no constraints have both sides selected", () => {
    const payload = makePayload({
      constraints: [
        { uuid: "cccc1111", source_uuid: "eeee1111", target_uuid: "eeee2222", op: "equals", value: "" },
      ],
    });
    const result = constraintsBothSidesIn(payload, new Set(["eeee1111"]));
    expect(result).toEqual([]);
  });
});

describe("regex strictness", () => {
  it("does NOT match @{nothex} (non-hex char)", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [{ value: "@{nothex01}", weight: 1 }], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["11111111"]).toEqual([]);
  });

  it("does NOT match @{1234567} (7 chars, too short)", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [{ value: "@{1234567}", weight: 1 }], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["11111111"]).toEqual([]);
  });

  it("does NOT match @{123456789} (9 chars, too long)", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [{ value: "@{123456789}", weight: 1 }], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    // Regex requires exactly 8 hex chars; 9-char string doesn't match at all.
    expect(graph["11111111"]).toEqual([]);
  });

  it("matches subcategory suffix @{uuid:subcat}", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "x", options: [{ value: "@{aabbccdd:color}", weight: 1 }], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["11111111"]).toContain("aabbccdd");
  });
});

describe("transitiveClosure overload", () => {
  it("accepts a pre-built graph and returns identical result to the payload form", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "11111111", name: "a", options: [{ value: "@{22222222}", weight: 1 }], tags: [] },
        { uuid: "22222222", name: "b", options: [{ value: "@{33333333}", weight: 1 }], tags: [] },
        { uuid: "33333333", name: "c", options: [], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    const fromPayload = transitiveClosure(payload, new Set(["11111111"]));
    const fromGraph = transitiveClosure(graph, new Set(["11111111"]));
    expect(fromGraph).toEqual(fromPayload);
    expect(fromGraph).toEqual(new Set(["11111111", "22222222", "33333333"]));
  });

  it("graph-form does not require all UUIDs to be keys (empty edges treated as no-deps)", () => {
    // Caller may pass a graph derived from a partial payload. Missing keys
    // should behave like empty edge lists (no-deps).
    const graph: Record<string, string[]> = { "11111111": ["22222222"] };
    const closure = transitiveClosure(graph, new Set(["11111111"]));
    expect(closure).toEqual(new Set(["11111111", "22222222"]));
  });
});
