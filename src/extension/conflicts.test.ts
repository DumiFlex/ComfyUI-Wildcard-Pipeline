import { describe, it, expect } from "vitest";
import { scanConflicts } from "./conflicts";
import type { ContextWidgetValue } from "../widgets/_shared";

const mod = (id: string, vars: string[]): ContextWidgetValue["modules"][number] => ({
  id, type: "fixed_values", enabled: true, meta: { name: "" },
  entries: vars.map((v) => ({ variable_name: v, value: "x" })),
});

describe("scanConflicts", () => {
  it("flags shadows_upstream (info) when a module writes a var present upstream", () => {
    const value: ContextWidgetValue = { version: 1, modules: [mod("m1", ["style"])] };
    const out = scanConflicts(value, ["style"]);
    expect(out).toEqual([{ moduleId: "m1", variable: "style", type: "shadows_upstream", severity: "info" }]);
  });

  it("flags duplicate_variable (warning) when two modules in same node both write the same var", () => {
    const value: ContextWidgetValue = { version: 1, modules: [mod("m1", ["style"]), mod("m2", ["style"])] };
    const out = scanConflicts(value, []);
    expect(out).toEqual([{ moduleId: "m2", variable: "style", type: "duplicate_variable", severity: "warning" }]);
  });

  it("upstream shadow wins over in-node duplicate (mutually exclusive)", () => {
    const value: ContextWidgetValue = { version: 1, modules: [mod("m1", ["style"]), mod("m2", ["style"])] };
    const out = scanConflicts(value, ["style"]);
    expect(out.every((c) => c.type === "shadows_upstream")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("does not flag unrelated names — `sty` does not shadow `style`", () => {
    const value: ContextWidgetValue = { version: 1, modules: [mod("m1", ["sty"])] };
    expect(scanConflicts(value, ["style"])).toEqual([]);
  });

  it("does not flag duplicate when fixed_values entries + payload.values overlap (same module)", () => {
    // Library-picked / saved fixed_values carries the SAME names in both
    // `entries` (UI) and `payload.values` (engine). Naive concat would
    // surface every name twice → false `duplicate_variable`. Regression
    // for the bug where freshly-picked fixed_values cards lit up red.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [{
        id: "m1",
        type: "fixed_values",
        enabled: true,
        meta: { name: "" },
        entries: [{ variable_name: "style", value: "x" }, { variable_name: "tone", value: "y" }],
        payload: { values: [
          { id: "val_0000", name: "style", value: "x" },
          { id: "val_0001", name: "tone", value: "y" },
        ] },
      }],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });
});

const combine = (
  id: string,
  template: string,
  outputVar = "out",
): ContextWidgetValue["modules"][number] => ({
  id, type: "combine", enabled: true, meta: { name: "" },
  entries: [],
  payload: { template, output_var: outputVar, input_vars: [] },
});

describe("scanConflicts — combine template var checks", () => {
  it("flags missing_template_variable (warning) when a combine references a $var nothing upstream provides", () => {
    const value: ContextWidgetValue = { version: 1, modules: [combine("c1", "$a and $b were near $c")] };
    // Only $a + $b exist upstream; $c missing.
    const out = scanConflicts(value, ["a", "b"]);
    expect(out).toEqual([
      { moduleId: "c1", variable: "c", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("does not flag $vars satisfied by an earlier sibling module's writes", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        mod("m1", ["a"]),                          // writes $a
        combine("c1", "say $a now"),               // refs $a — satisfied
      ],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });

  it("does not flag a $var written LATER (template scan respects order)", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        combine("c1", "say $a now"),               // refs $a — not yet bound
        mod("m1", ["a"]),                          // writes $a after combine
      ],
    };
    const out = scanConflicts(value, []);
    expect(out).toEqual([
      { moduleId: "c1", variable: "a", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("dedups repeated missing names within the same template", () => {
    const value: ContextWidgetValue = { version: 1, modules: [combine("c1", "$x and $x and $x")] };
    const out = scanConflicts(value, []);
    expect(out).toEqual([
      { moduleId: "c1", variable: "x", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("disabled combines do not generate template warnings", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [{ ...combine("c1", "$missing"), enabled: false }],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });
});
