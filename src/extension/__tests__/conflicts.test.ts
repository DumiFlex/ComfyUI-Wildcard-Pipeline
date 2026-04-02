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

  it("constrain module with target defined AFTER it → no conflict (correct ordering)", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("constrain module with target defined BEFORE it → warning (already sampled)", () => {
    const modules: PipelineModule[] = [
      { type: "wildcard", capture_as: "$weather" },
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 1,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("already sampled");
  });

  it("constrain module with target NOT in pipeline at all → warning (not defined)", () => {
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
    expect(result[0].message).toContain("not defined");
  });

  it("constrain module with target from upstream context → warning (already sampled)", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, ["weather"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("already sampled");
  });

  it("constrain rule with when_variable not in pipeline → unresolved_constraint_when_variable warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$weather" },
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
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("constrain rule with when_variable defined AFTER constrain but in same pipeline → no warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$lighting" },
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("constrain rule target already sampled upstream → warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
    const result = analyzePipelineConflicts(modules, ["lighting", "weather"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("already sampled");
  });

  it("constrain rule target not in pipeline at all → warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
    const result = analyzePipelineConflicts(modules, ["lighting"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("not defined");
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

  it("constrain target in downstream node → no conflict", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, [], ["weather"]);
    expect(result).toEqual([]);
  });

  it("constrain rule target in downstream node → no conflict", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
    const result = analyzePipelineConflicts(modules, ["lighting"], ["weather"]);
    expect(result).toEqual([]);
  });

  it("constrain when_variable in downstream node with target future → ordering warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, [], ["lighting"]);
    const ordering = result.filter((c) => c.type === "unresolved_constraint_when_variable");
    expect(ordering).toHaveLength(1);
    expect(ordering[0].message).toContain("won't be resolved before");
  });

  it("constrain target not in upstream, this node, or downstream → warning", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, ["lighting"], ["location"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("not defined");
  });

  it("constrain when_variable not in upstream, this node, or downstream → warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
        rules: [
          {
            target: "weather",
            when_variable: "nonexistent",
            when_value: "x",
            rule_type: "exclusion",
            values: ["fog"],
          },
        ],
      },
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, ["lighting"], ["location"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      moduleIndex: 0,
      type: "unresolved_constraint_when_variable",
      severity: "warning",
    });
    expect(result[0].message).toContain("$nonexistent");
  });

  it("full cross-node scenario: upstream lighting, this node constrain, downstream weather → no conflict", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
        rules: [
          {
            target: "weather",
            when_variable: "lighting",
            when_value: "moonlight",
            rule_type: "exclusion",
            values: ["sunny haze"],
          },
        ],
      },
    ];
    const result = analyzePipelineConflicts(modules, ["lighting"], ["weather"]);
    expect(result).toEqual([]);
  });

  it("constrain target in upstream (already sampled) still warns even with downstream vars", () => {
    const modules: PipelineModule[] = [
      { type: "constrain", target: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, ["weather"], ["location"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "unresolved_constraint_target",
      severity: "warning",
    });
    expect(result[0].message).toContain("already sampled");
  });

  it("constrain when_variable after target in same node → ordering warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$weather" },
      { type: "wildcard", capture_as: "$lighting" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    const ordering = result.filter((c) => c.type === "unresolved_constraint_when_variable");
    expect(ordering).toHaveLength(1);
    expect(ordering[0].message).toContain("won't be resolved before");
    expect(ordering[0].message).toContain("$lighting");
    expect(ordering[0].message).toContain("$weather");
  });

  it("constrain when_variable before target in same node → no ordering warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$lighting" },
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, []);
    expect(result).toEqual([]);
  });

  it("constrain when_variable upstream, target future → no ordering warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, ["lighting"]);
    expect(result).toEqual([]);
  });

  it("constrain when_variable in downstream, target in this node future → ordering warning", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
      { type: "wildcard", capture_as: "$weather" },
    ];
    const result = analyzePipelineConflicts(modules, [], ["lighting"]);
    const ordering = result.filter((c) => c.type === "unresolved_constraint_when_variable");
    expect(ordering).toHaveLength(1);
    expect(ordering[0].message).toContain("won't be resolved before");
  });

  it("constrain when_variable and target both downstream → no ordering warning from this node", () => {
    const modules: PipelineModule[] = [
      {
        type: "constrain",
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
    const result = analyzePipelineConflicts(modules, [], ["lighting", "weather"]);
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
