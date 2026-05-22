import { describe, expect, it } from "vitest";
import { buildDepGraph, transitiveClosure, constraintsBothSidesIn } from "../dep-graph";
import type { RawPayload } from "../migrations";

function makePayload(parts: Partial<RawPayload>): RawPayload {
  return {
    schema_version: 1,
    bundles: parts.bundles ?? [],
    wildcards: parts.wildcards ?? [],
    variables: parts.variables ?? [],
    constraints: parts.constraints ?? [],
  };
}

describe("buildDepGraph", () => {
  it("captures wildcard @{uuid} refs in option values as outgoing edges", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "w1", name: "x", options: [{ value: "see @{w2} now", weight: 1 }], tags: [] },
        { uuid: "w2", name: "y", options: [], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["w1"]).toContain("w2");
    expect(graph["w2"]).toEqual([]);
  });

  it("captures bundle children inner-bundle refs", () => {
    const payload = makePayload({
      bundles: [
        { uuid: "b1", name: "outer", children: [{ uuid: "b2", type: "bundle" }] },
        { uuid: "b2", name: "inner", children: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["b1"]).toContain("b2");
  });

  it("ignores bundle children with non-bundle type", () => {
    const payload = makePayload({
      bundles: [
        { uuid: "b1", name: "x", children: [{ uuid: "m1", type: "module" }] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["b1"]).not.toContain("m1");
  });

  it("captures constraint source + target as outgoing edges", () => {
    const payload = makePayload({
      constraints: [{ uuid: "c1", source_uuid: "v1", target_uuid: "v2", op: "equals", value: "x" }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["c1"]).toEqual(expect.arrayContaining(["v1", "v2"]));
  });

  it("variables have empty edge list", () => {
    const payload = makePayload({
      variables: [{ uuid: "v1", name: "v1", value: "x", tags: [] }],
    });
    const graph = buildDepGraph(payload);
    expect(graph["v1"]).toEqual([]);
  });

  it("dedupes multiple refs to same UUID in same wildcard", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "w1", name: "x", options: [
          { value: "@{w2} and @{w2}", weight: 1 },
        ], tags: [] },
      ],
    });
    const graph = buildDepGraph(payload);
    expect(graph["w1"]).toEqual(["w2"]);
  });
});

describe("transitiveClosure", () => {
  it("walks outgoing refs to fixed point", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "a", name: "a", options: [{ value: "@{b}", weight: 1 }], tags: [] },
        { uuid: "b", name: "b", options: [{ value: "@{c}", weight: 1 }], tags: [] },
        { uuid: "c", name: "c", options: [], tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["a"]));
    expect(closure).toEqual(new Set(["a", "b", "c"]));
  });

  it("handles cycles without infinite loop", () => {
    const payload = makePayload({
      wildcards: [
        { uuid: "a", name: "a", options: [{ value: "@{b}", weight: 1 }], tags: [] },
        { uuid: "b", name: "b", options: [{ value: "@{a}", weight: 1 }], tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["a"]));
    expect(closure).toEqual(new Set(["a", "b"]));
  });

  it("does not include reverse deps (constraints referencing a selected variable)", () => {
    const payload = makePayload({
      constraints: [{ uuid: "c1", source_uuid: "v1", target_uuid: "v2", op: "equals", value: "x" }],
      variables: [
        { uuid: "v1", name: "v1", value: "", tags: [] },
        { uuid: "v2", name: "v2", value: "", tags: [] },
      ],
    });
    const closure = transitiveClosure(payload, new Set(["v1"]));
    expect(closure.has("c1")).toBe(false);
  });

  it("empty seed returns empty closure", () => {
    const payload = makePayload({
      wildcards: [{ uuid: "a", name: "a", options: [], tags: [] }],
    });
    expect(transitiveClosure(payload, new Set())).toEqual(new Set());
  });
});

describe("constraintsBothSidesIn", () => {
  it("returns constraints whose source AND target are in selection", () => {
    const payload = makePayload({
      constraints: [
        { uuid: "c1", source_uuid: "v1", target_uuid: "v2", op: "equals", value: "" },
        { uuid: "c2", source_uuid: "v1", target_uuid: "v3", op: "equals", value: "" },
      ],
    });
    const result = constraintsBothSidesIn(payload, new Set(["v1", "v2"]));
    expect(result).toEqual(["c1"]);
  });

  it("returns empty when no constraints have both sides selected", () => {
    const payload = makePayload({
      constraints: [
        { uuid: "c1", source_uuid: "v1", target_uuid: "v2", op: "equals", value: "" },
      ],
    });
    const result = constraintsBothSidesIn(payload, new Set(["v1"]));
    expect(result).toEqual([]);
  });
});
