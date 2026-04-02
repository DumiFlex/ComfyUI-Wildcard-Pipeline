import { describe, it, expect } from "vitest";
import { analyzePipelineConflicts, analyzeInjectConflicts } from "../conflicts";
import type { PipelineModule } from "@/types";

// ---------------------------------------------------------------------------
// analyzePipelineConflicts
// ---------------------------------------------------------------------------

describe("analyzePipelineConflicts", () => {
  it("returns empty array for clean pipeline with no modules", () => {
    const result = analyzePipelineConflicts([], []);
    expect(result).toEqual([]);
  });

  it("single wildcard capturing a new var returns no conflict", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("two wildcard modules capturing the same var → duplicate_variable error", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
      { type: "wildcard", capture_as: "$location" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 1,
      type: "duplicate_variable",
      severity: "error",
    });
    expect(result[0].message).toContain("$location");
    expect(result[0].message).toContain("already captured");
  });

  it("wildcard capturing var that exists in upstreamVariables → context_overwrite error", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
    ];
    const result = analyzePipelineConflicts(modules, ["location"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "context_overwrite",
      severity: "error",
    });
    expect(result[0].message).toContain("$location");
    expect(result[0].message).toContain("overwrites");
  });

  it("constrain module with target present in pipeline → no conflict", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$weather" },
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("constrain module with target NOT in pipeline → unresolved_constraint_target warning", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("$weather");
    expect(result[0].message).toContain("not defined");
  });

  it("constrain rule with when_variable not in pipeline → unresolved_constraint_when_variable warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
        target: undefined,
        rules: [
          {
            target: "weather",
            when_variable: "lighting",
            when_value: "moonlight",
            rule_type: "exclusion",
            values: ["fog"],
          },
        ],
      },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_when_variable",
      severity: "warning",
    });
    expect(result[0].message).toContain("$lighting");
  });

  it("constrain rule with when_variable present in pipeline → no warning", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$lighting" },
      {
        type: "constrain",
        target: undefined,
        rules: [
          {
            target: "weather",
            when_variable: "lighting",
            when_value: "moonlight",
            rule_type: "exclusion",
            values: ["fog"],
          },
        ],
      },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("combine module referencing existing var → no conflict", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
      { type: "combine", template: "A $location scene", capture_as: "$scene" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("combine module referencing undefined var → missing_template_variable warning", () => {
    const modules: PipelineModule[] = [
      { type: "combine", template: "A $location scene", capture_as: "$scene" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "missing_template_variable",
      severity: "warning",
    });
    expect(result[0].message).toContain("$location");
    expect(result[0].message).toContain("undefined");
  });

  it("condition module referencing existing var → no conflict", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$lighting" },
      {
        type: "condition",
        variable: "lighting",
        if_equals: "moonlight",
        value: "dark",
        capture_as: "$mood",
      },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("condition module referencing undefined var → missing_template_variable warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "condition",
        variable: "lighting",
        value: "dark",
        capture_as: "$mood",
      },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "missing_template_variable",
      severity: "warning",
    });
    expect(result[0].message).toContain("$lighting");
  });

  it("$$ escaped dollar sign in combine template is not treated as a var reference", () => {
    const modules: PipelineModule[] = [
      { type: "combine", template: "price: $$10", capture_as: "$price" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    // $$ should not produce a missing_template_variable for "10"
    expect(result).toEqual([]);
  });

  it("variable accumulates across modules — var captured at index 0 is available at index 2", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
      { type: "fixed", value: "noon", capture_as: "$time" },
      { type: "combine", template: "$location at $time", capture_as: "$scene" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("fixed module capturing a var that already exists → duplicate_variable error", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$mood" },
      { type: "fixed", value: "happy", capture_as: "$mood" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("duplicate_variable");
    expect(result[0].moduleIndex).toBe(1);
  });

  it("__prefixed variables in combine template are skipped", () => {
    const modules: PipelineModule[] = [
      { type: "combine", template: "$__internal_key is special", capture_as: "$out" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("upstream variables allow combine references without conflict", () => {
    const modules: PipelineModule[] = [
      { type: "combine", template: "I am at $location", capture_as: "$scene" },
    ];
    const result = analyzePipelineConflicts(modules, ["location"]);
    expect(result).toEqual([]);
  });

  it("multiple conflicts are all returned in order", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$a" },
      { type: "wildcard", capture_as: "$a" }, // duplicate
      { type: "combine", template: "$missing_var", capture_as: "$b" }, // missing var
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("duplicate_variable");
    expect(result[1].type).toBe("missing_template_variable");
  });

  it("export module does not cause any conflicts", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$location" },
      { type: "export", variables: ["location"] },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// analyzeInjectConflicts
// ---------------------------------------------------------------------------

describe("analyzeInjectConflicts", () => {
  it("no conflicts for fresh variables → empty array", () => {
    const mapping = { input_1: "myvar" };
    const result = analyzeInjectConflicts(mapping, ["input_1"], []);
    expect(result).toEqual([]);
  });

  it("disconnected slot is ignored even if variable would conflict", () => {
    const mapping = { input_1: "location" };
    // input_1 is NOT connected
    const result = analyzeInjectConflicts(mapping, [], ["location"]);
    expect(result).toEqual([]);
  });

  it("connected slot with empty variable name → no conflict", () => {
    const mapping = { input_1: "" };
    const result = analyzeInjectConflicts(mapping, ["input_1"], []);
    expect(result).toEqual([]);
  });

  it("overwrite upstream var → context_overwrite error", () => {
    const mapping = { input_1: "location" };
    const result = analyzeInjectConflicts(mapping, ["input_1"], ["location"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "context_overwrite",
      severity: "error",
    });
    expect(result[0].message).toContain("$location");
    expect(result[0].message).toContain("overwrites");
  });

  it("$-prefixed variable name in mapping is stripped and checked", () => {
    const mapping = { input_2: "$lighting" };
    const result = analyzeInjectConflicts(mapping, ["input_2"], ["lighting"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("context_overwrite");
    expect(result[0].moduleIndex).toBe(1); // input_2 → index 1
  });

  it("two connected slots using same var name → duplicate_variable error", () => {
    const mapping = { input_1: "theme", input_2: "theme" };
    const result = analyzeInjectConflicts(mapping, ["input_1", "input_2"], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 1,
      type: "duplicate_variable",
      severity: "error",
    });
    expect(result[0].message).toContain("$theme");
    expect(result[0].message).toContain("already used");
  });

  it("Set as connectedSlots parameter works the same as array", () => {
    const mapping = { input_1: "x", input_2: "x" };
    const result = analyzeInjectConflicts(mapping, new Set(["input_1", "input_2"]), []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("duplicate_variable");
  });

  it("three unique variables across three slots → no conflicts", () => {
    const mapping = { input_1: "a", input_2: "b", input_3: "c" };
    const result = analyzeInjectConflicts(mapping, ["input_1", "input_2", "input_3"], []);
    expect(result).toEqual([]);
  });
});
