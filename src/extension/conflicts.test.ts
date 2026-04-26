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
});
