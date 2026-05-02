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

const derivation = (
  id: string,
  rules: Array<{
    branches: Array<{
      condition: { var: string; op?: string; value?: string };
      action: { target_var: string; mode?: string; value?: string };
    }>;
    else?: { action: { target_var: string; mode?: string; value?: string } };
  }>,
): ContextWidgetValue["modules"][number] => ({
  id, type: "derivation", enabled: true, meta: { name: "" },
  entries: [],
  payload: { rules: rules.map((r, i) => ({ id: `r${i}`, ...r })) },
});

describe("scanConflicts — derivation var/template scanning", () => {
  it("flags missing_template_variable when condition.var isn't upstream/sibling", () => {
    // `if $age == "30" → $mood = "calm"` references $age (read) and writes
    // $mood. Without upstream $age the read can never match — surface.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        derivation("d1", [{
          branches: [{
            condition: { var: "age", op: "equals", value: "30" },
            action: { target_var: "mood", mode: "replace", value: "calm" },
          }],
        }]),
      ],
    };
    const out = scanConflicts(value, []);
    expect(out).toEqual([
      { moduleId: "d1", variable: "age", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("flags missing_template_variable when action.value template references unknown $var", () => {
    // action.value passes through resolve_text under derivation surface, so
    // `$style` inside MUST resolve at runtime — same gap as combine.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        derivation("d1", [{
          branches: [{
            condition: { var: "age", op: "equals", value: "30" },
            action: { target_var: "mood", mode: "replace", value: "feeling $style" },
          }],
        }]),
      ],
    };
    // age provided upstream; $style is the gap.
    const out = scanConflicts(value, ["age"]);
    expect(out).toEqual([
      { moduleId: "d1", variable: "style", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("scans else.action.value templates too", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        derivation("d1", [{
          branches: [{
            condition: { var: "age", op: "equals", value: "30" },
            action: { target_var: "mood", mode: "replace", value: "calm" },
          }],
          else: { action: { target_var: "mood", mode: "replace", value: "fallback $tone" } },
        }]),
      ],
    };
    const out = scanConflicts(value, ["age"]);
    expect(out).toEqual([
      { moduleId: "d1", variable: "tone", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("dedups repeated missing names across condition.var + action.value within a module", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        derivation("d1", [{
          branches: [{
            condition: { var: "x", op: "equals", value: "y" },
            action: { target_var: "out", mode: "replace", value: "$x and $x" },
          }],
        }]),
      ],
    };
    // Both the condition and the template reference $x. Surface once.
    expect(scanConflicts(value, [])).toEqual([
      { moduleId: "d1", variable: "x", type: "missing_template_variable", severity: "warning" },
    ]);
  });

  it("does not flag derivation reads satisfied by earlier sibling writes", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        mod("m1", ["age"]),
        derivation("d1", [{
          branches: [{
            condition: { var: "age", op: "equals", value: "30" },
            action: { target_var: "mood", mode: "replace", value: "calm" },
          }],
        }]),
      ],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });

  it("disabled derivations do not generate read/template warnings", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        { ...derivation("d1", [{
          branches: [{
            condition: { var: "missing", op: "equals", value: "x" },
            action: { target_var: "out", mode: "replace", value: "$alsoMissing" },
          }],
        }]), enabled: false },
      ],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });
});

const wildcard = (
  id: string,
  varBinding: string,
): ContextWidgetValue["modules"][number] => ({
  id, type: "wildcard", enabled: true, meta: { name: "" },
  entries: [],
  payload: {
    var_binding: varBinding,
    options: [{ id: "o1", value: "x", weight: 1 }],
  },
});

const constraint = (
  id: string,
  source_wildcard_id: string,
  target_wildcard_id: string,
): ContextWidgetValue["modules"][number] => ({
  id, type: "constraint", enabled: true, meta: { name: "" },
  entries: [],
  payload: {
    source_wildcard_id,
    target_wildcard_id,
    matrix: {},
    exceptions: [],
  },
});

describe("scanConflicts — constraint ordering", () => {
  it("clean chain: source in upstream + target in same node AFTER constraint = no warning", () => {
    // Source `aaaa1111` lives upstream (in another Context), target
    // `bbbb2222` is the wildcard that comes RIGHT AFTER this constraint
    // in the local module list — the canonical happy path.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    expect(scanConflicts(value, [], ["aaaa1111"])).toEqual([]);
  });

  it("flags constraint_source_after_self when source wildcard is later in the same node", () => {
    // Source comes AFTER the constraint — its pick won't be in
    // `__wp_picks__` when the wildcard handler reads constraints.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),  // index 0
        wildcard("aaaa1111", "hair"),              // index 1 — too late
        wildcard("bbbb2222", "outfit"),            // index 2
      ],
    };
    const out = scanConflicts(value, []);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "aaaa1111",
      type: "constraint_source_after_self",
      severity: "warning",
    });
  });

  it("flags constraint_source_missing when source uuid is nowhere reachable", () => {
    // No source wildcard in this node, no upstream entry either.
    // Could be a typo / deleted module / source-in-downstream
    // (which still wouldn't pick before this constraint runs).
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa9999", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], []);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "aaaa9999",
      type: "constraint_source_missing",
      severity: "warning",
    });
  });

  it("flags constraint_target_before_self when target wildcard is earlier in the same node", () => {
    // Target picks BEFORE the constraint loads — matrix never reaches it.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        wildcard("bbbb2222", "outfit"),            // index 0 — too early
        constraint("c1", "aaaa1111", "bbbb2222"),  // index 1
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "bbbb2222",
      type: "constraint_target_before_self",
      severity: "warning",
    });
  });

  it("flags constraint_target_in_upstream when target lives in an upstream Context", () => {
    // Target in upstream chain → already picked when this constraint
    // runs. The constraint can't influence a pick that already happened.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111", "bbbb2222"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "bbbb2222",
      type: "constraint_target_in_upstream",
      severity: "warning",
    });
  });

  it("flags constraint_target_missing when uuid is unfindable", () => {
    // Target neither in this node nor upstream. Could legitimately
    // be in a downstream Context, but QA prefers a soft warning over
    // silence — false-positive noise is cheaper than missed typos /
    // deleted modules. The label "target missing" is intentionally
    // soft so the user can interpret the situation.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbbeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "bbbbeeee",
      type: "constraint_target_missing",
      severity: "warning",
    });
  });

  it("disabled constraints do not generate ordering warnings", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        { ...constraint("c1", "aaaa9999", "bbbb_missing"), enabled: false },
      ],
    };
    expect(scanConflicts(value, [])).toEqual([]);
  });

  it("source AND target both wrong → both warnings emit on the same constraint", () => {
    // Stress: source missing, target before the constraint. The card
    // tooltip should show both — a constraint can carry multiple
    // simultaneous problems, and surfacing only one would mask the rest.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        wildcard("bbbb2222", "outfit"),                   // target too early
        constraint("c1", "aaaa9999", "bbbb2222"),
      ],
    };
    const out = scanConflicts(value, [], []);
    const types = out.filter((c) => c.moduleId === "c1").map((c) => c.type);
    expect(types).toContain("constraint_source_missing");
    expect(types).toContain("constraint_target_before_self");
  });
});
