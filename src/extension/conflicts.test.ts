import { describe, it, expect } from "vitest";
import { scanConflicts, scanInjectorConflicts } from "./conflicts";
import type { ContextWidgetValue, InjectorRowsValue } from "../widgets/_shared";

function injRow(over: Partial<InjectorRowsValue["rows"][number]> = {}): InjectorRowsValue["rows"][number] {
  return {
    _uid: "uid",
    slot_name: "input_0",
    binding: "x",
    enabled: true,
    internal: false,
    ...over,
  };
}

describe("scanInjectorConflicts", () => {
  it("flags row with empty binding as injector_binding_missing", () => {
    // Empty binding = socket linked but user hasn't typed the
    // variable name. Distinct from injector_input_disconnected which
    // means the socket has no wire.
    const value: InjectorRowsValue = {
      version: 1,
      rows: [injRow({ binding: "" })],
    };
    const out = scanInjectorConflicts(value, []);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("injector_binding_missing");
  });

  // Severed-socket conflict (injector_input_disconnected) was retired —
  // InjectorWidget auto-removes rows whose slot is no longer in
  // connectedSlots, so the case is unreachable in practice. Test
  // dropped alongside the conflict type itself.

  it("flags duplicate bindings as duplicate_variable across enabled injector rows", () => {
    const value: InjectorRowsValue = {
      version: 1,
      rows: [
        injRow({ _uid: "a", slot_name: "input_0", binding: "foo" }),
        injRow({ _uid: "b", slot_name: "input_1", binding: "foo" }),
      ],
    };
    const out = scanInjectorConflicts(value, ["input_0", "input_1"]);
    expect(out.find((c) => c.type === "duplicate_variable")?.variable).toBe("foo");
  });

  it("returns empty list when all rows are well-formed and unique", () => {
    const value: InjectorRowsValue = {
      version: 1,
      rows: [
        injRow({ _uid: "a", slot_name: "input_0", binding: "alpha" }),
        injRow({ _uid: "b", slot_name: "input_1", binding: "beta" }),
      ],
    };
    expect(scanInjectorConflicts(value, ["input_0", "input_1"])).toEqual([]);
  });
});

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
      type: "constraint_orphan_source",
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
      type: "constraint_orphan_target",
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
      type: "constraint_orphan_target",
      severity: "warning",
    });
  });

  it("flags constraint_target_missing only when uuid is unfindable upstream AND downstream", () => {
    // Target genuinely missing — not in this node, upstream, OR
    // downstream. Real typo / deleted module. With the new downstream
    // visibility the scanner stops false-flagging legitimate
    // downstream targets.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbbeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"], []);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "bbbbeeee",
      type: "constraint_target_missing",
      severity: "warning",
    });
  });

  it("does NOT flag target when uuid lives in the downstream chain (the GOOD case)", () => {
    // Target downstream = picks AFTER this constraint's Context runs,
    // so the matrix applies as designed. Pre-downstream-walker this
    // scenario flagged as "missing" because the scanner couldn't see
    // past its own node.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "ddddeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"], ["ddddeeee"]);
    expect(out.find((c) => c.moduleId === "c1" && c.type.startsWith("constraint_target_"))).toBeUndefined();
  });

  it("source-only-downstream is flagged as orphan (no upstream instance)", () => {
    // Source only exists downstream → no upstream pick available when
    // this constraint runs. Surfaces as `constraint_orphan_source`
    // under the 2026-05-24 unified rule. (Previously: legacy
    // `constraint_source_in_downstream` — dropped.)
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "ddddssss", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], [], ["ddddssss"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "ddddssss",
      type: "constraint_orphan_source",
      severity: "warning",
    });
  });

  it("source upstream + ALSO downstream is NOT flagged (false-positive fix)", () => {
    // Pre-2026-05-24 the scanner flagged `source_in_downstream`
    // whenever the source ALSO appeared downstream — even if a valid
    // upstream instance existed. New rule: only flag when NO upstream
    // instance. Same source uuid in both directions is fine.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "ddddssss", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], ["ddddssss"], ["ddddssss"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type === "constraint_orphan_source"),
    ).toBeUndefined();
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
    expect(types).toContain("constraint_orphan_target");
  });

  it("two duplicated constraints both find their downstream slot when the target has TWO downstream instances", () => {
    // Regression: pre-2026-05-24 the scanner collapsed the downstream
    // count to 0/1 via a Set, so duplicating a constraint when the
    // target wildcard also lived downstream cross-node twice still
    // false-flagged the second constraint as `constraint_orphan_target`.
    // collectDownstreamWildcardUuids now returns per-instance entries
    // and scanConflicts counts them, matching the engine's one-shot
    // first-instance semantics (each constraint claims one downstream
    // target slot).
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "ddddeeee"),
        constraint("c2", "aaaa1111", "ddddeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"], ["ddddeeee", "ddddeeee"]);
    expect(out.find((c) => c.type === "constraint_orphan_target")).toBeUndefined();
  });

  it("two duplicated constraints with only ONE downstream target instance → second flags orphan", () => {
    // Mirror of the case above: not enough downstream slots, so the
    // second constraint correctly orphans (matches engine: only the
    // first constraint would ever apply).
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "ddddeeee"),
        constraint("c2", "aaaa1111", "ddddeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"], ["ddddeeee"]);
    const orphans = out.filter((c) => c.type === "constraint_orphan_target");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].moduleId).toBe("c2");
  });

  it("constraint #1 claims local slot between itself and #2; #2 claims downstream — no orphan", () => {
    // User-reported regression. Setup:
    //   idx 0: c1                          local mood at idx 1 available
    //   idx 1: wildcard mood               consumed by c1's claim
    //   idx 2: c2                          no local mood after idx 2
    //   downstream chain: one mood instance
    //
    // The pre-slot-allocator logic used a flat `claimedSoFar` counter:
    // c1's claim incremented it to 1, and c2 saw available = local-after-
    // self(0) + downstream(1) = 1, so claimedSoFar(1) >= available(1)
    // false-orphaned c2. Slot allocator pairs c1 → idx 1, c2 → downstream
    // instance, neither flags.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "ddddeeee"),
        wildcard("ddddeeee", "mood"),
        constraint("c2", "aaaa1111", "ddddeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"], ["ddddeeee"]);
    expect(out.find((c) => c.type === "constraint_orphan_target")).toBeUndefined();
  });

  it("constraint after its local target + no downstream — orphans", () => {
    // The local mood instance sits at idx 0 (upstream of the constraint
    // at idx 1) and there's no downstream chain. Engine resolves
    // first-instance-AFTER the constraint, so this constraint has no
    // claim available.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        wildcard("ddddeeee", "mood"),
        constraint("c1", "aaaa1111", "ddddeeee"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "ddddeeee",
      type: "constraint_orphan_target",
      severity: "warning",
    });
  });
});

// Helper: wildcard whose option value contains an @{} ref to another
// wildcard. Used to seed the nested-reach walker.
const wildcardWithRef = (
  id: string,
  varBinding: string,
  refUuid: string,
): ContextWidgetValue["modules"][number] => ({
  id, type: "wildcard", enabled: true, meta: { name: "" },
  entries: [],
  payload: {
    var_binding: varBinding,
    options: [{ id: "o1", value: `@{${refUuid}}`, weight: 1 }],
  },
});

describe("scanConflicts — constraint nested-reach classification", () => {
  it("target reachable via nested @{} from a later wildcard does NOT flag missing", () => {
    // `outer` at position 1 has option value `@{nested-uuid}`. Target
    // `nested-uuid` doesn't appear directly in chain but IS reachable
    // through nesting → constraint applies at ref-resolve time, no flag.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "aabbccdd"),
        wildcardWithRef("outer", "phrase", "aabbccdd"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type.startsWith("constraint_target_")),
    ).toBeUndefined();
  });

  it("target reachable via deep nested @{} chain (transitive) does NOT flag missing", () => {
    // outer → @{mid}; mid (in chain) → @{deep}. Constraint targets deep.
    // Walker expands through local catalog so deep counts as reachable.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "defacedb"),
        wildcardWithRef("outer", "phrase", "facedab0"),
        wildcardWithRef("facedab0", "mid", "defacedb"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type.startsWith("constraint_target_")),
    ).toBeUndefined();
  });

  it("target in upstream + ALSO downstream → no warning (downstream picks get constrained)", () => {
    // User has same wildcard in two Contexts: upstream copy already
    // picked, downstream copy will pick AFTER this constraint. The
    // downstream instance benefits → don't false-flag in_upstream.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111", "bbbb2222"], ["bbbb2222"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type === "constraint_orphan_target"),
    ).toBeUndefined();
  });

  it("target in upstream + ALSO in same node AFTER constraint → no warning", () => {
    // Two instances of bbbb2222: upstream (already picked) + local
    // after constraint (still to pick). The local-after instance gets
    // constrained, so don't flag.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111", "bbbb2222"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type.startsWith("constraint_target_")),
    ).toBeUndefined();
  });

  it("target ONLY upstream still flags target_in_upstream (no other bindable instance)", () => {
    // Sanity check that the rule didn't go too lax: when target is
    // genuinely only upstream + nothing downstream / local / nested,
    // the warning still fires.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111", "bbbb2222"], []);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "bbbb2222",
      type: "constraint_orphan_target",
      severity: "warning",
    });
  });

  it("nested @{} from a wildcard BEFORE the constraint does NOT count as bindable", () => {
    // Wildcard at index 0 has @{nested}, constraint at index 1 targets
    // nested. The outer wildcard already rolled (picking from `nested`
    // before constraint registered) → constraint can't bind to that
    // nested call. Without other bindable instance → flag missing.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        wildcardWithRef("outer", "phrase", "aabbccdd"),
        constraint("c1", "aaaa1111", "aabbccdd"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(out).toContainEqual({
      moduleId: "c1",
      variable: "aabbccdd",
      type: "constraint_target_missing",
      severity: "warning",
    });
  });

  it("nested @{} with sub-category filter still counts as a reachable target", () => {
    // `@{nested:warm}` is a valid ref form for the resolver and the
    // scanner — filter is metadata, doesn't change reachability.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "aabbccdd"),
        {
          id: "outer", type: "wildcard", enabled: true, meta: { name: "" },
          entries: [],
          payload: {
            var_binding: "phrase",
            options: [{ id: "o1", value: "@{aabbccdd:warm,cool}", weight: 1 }],
          },
        },
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(
      out.find((c) => c.moduleId === "c1" && c.type.startsWith("constraint_target_")),
    ).toBeUndefined();
  });
});

describe("conflict scanner — instance.variable_binding override", () => {
  it("reads instance.variable_binding before payload.var_binding", () => {
    // Two wildcards: m1 has payload.var_binding="outfit" but the user
    // overrode it via instance.variable_binding="renamed". m2 then
    // binds to "renamed" via its own payload. Scanner must see m1's
    // EFFECTIVE binding ("renamed") to flag the duplicate. Pre-fix
    // the scanner read m1.payload.var_binding ("outfit") and missed
    // the collision entirely.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "m1", type: "wildcard", enabled: true, meta: { name: "outfit" },
          entries: [],
          payload: { var_binding: "outfit", options: [{ id: "o1", value: "x", weight: 1 }] },
          instance: { variable_binding: "renamed" },
        },
        {
          id: "m2", type: "wildcard", enabled: true, meta: { name: "other" },
          entries: [],
          payload: { var_binding: "renamed", options: [{ id: "o1", value: "x", weight: 1 }] },
        },
      ],
    };
    const conflicts = scanConflicts(value, []);
    const dupes = conflicts.filter((c) => c.type === "duplicate_variable");
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]).toMatchObject({ moduleId: "m2", variable: "renamed" });
  });

  it("falls back to payload.var_binding when instance.variable_binding is empty/null", () => {
    // Empty string and null both mean "use library default" per the
    // _shared.ts contract. Scanner must not treat them as the
    // effective name.
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "m1", type: "wildcard", enabled: true, meta: { name: "outfit" },
          entries: [],
          payload: { var_binding: "outfit", options: [{ id: "o1", value: "x", weight: 1 }] },
          instance: { variable_binding: "" },
        },
        {
          id: "m2", type: "wildcard", enabled: true, meta: { name: "other" },
          entries: [],
          payload: { var_binding: "outfit", options: [{ id: "o1", value: "x", weight: 1 }] },
          instance: { variable_binding: null },
        },
      ],
    };
    const conflicts = scanConflicts(value, []);
    const dupes = conflicts.filter((c) => c.type === "duplicate_variable");
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]).toMatchObject({ moduleId: "m2", variable: "outfit" });
  });
});

describe("conflict scanner — cross-kind same-node override demotion", () => {
  it("wildcard $test after fixed_values $test in same node = shadows_upstream (info), not duplicate", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "fv01", type: "fixed_values", enabled: true,
          meta: { name: "default" },
          entries: [{ variable_name: "test", value: "default" }],
          payload: { values: [{ id: "v1", name: "test", value: "default" }] },
        },
        {
          id: "wc01", type: "wildcard", enabled: true,
          meta: { name: "rand" },
          entries: [],
          payload: { var_binding: "test", options: [{ id: "o1", value: "x", weight: 1 }] },
        },
      ],
    };
    const conflicts = scanConflicts(value, []);
    const dupes = conflicts.filter((c) => c.type === "duplicate_variable");
    const shadows = conflicts.filter((c) => c.type === "shadows_upstream" && c.variable === "test");
    expect(dupes).toHaveLength(0);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toMatchObject({ moduleId: "wc01", variable: "test", severity: "info" });
  });

  it("fixed_values $test after wildcard $test in same node also demoted (reverse direction)", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "wc01", type: "wildcard", enabled: true,
          meta: { name: "rand" },
          entries: [],
          payload: { var_binding: "test", options: [{ id: "o1", value: "x", weight: 1 }] },
        },
        {
          id: "fv01", type: "fixed_values", enabled: true,
          meta: { name: "default" },
          entries: [{ variable_name: "test", value: "default" }],
          payload: { values: [{ id: "v1", name: "test", value: "default" }] },
        },
      ],
    };
    const conflicts = scanConflicts(value, []);
    const dupes = conflicts.filter((c) => c.type === "duplicate_variable");
    const shadows = conflicts.filter((c) => c.type === "shadows_upstream" && c.variable === "test");
    expect(dupes).toHaveLength(0);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toMatchObject({ moduleId: "fv01" });
  });

  it("two wildcards in same node both writing $color STILL flag duplicate_variable (likely bug)", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "w1", type: "wildcard", enabled: true,
          meta: { name: "a" },
          entries: [],
          payload: { var_binding: "color", options: [{ id: "o1", value: "x", weight: 1 }] },
        },
        {
          id: "w2", type: "wildcard", enabled: true,
          meta: { name: "b" },
          entries: [],
          payload: { var_binding: "color", options: [{ id: "o1", value: "y", weight: 1 }] },
        },
      ],
    };
    const conflicts = scanConflicts(value, []);
    const dupes = conflicts.filter((c) => c.type === "duplicate_variable");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ moduleId: "w2", variable: "color" });
  });
});

describe("scanConflicts — nested bundle gate cascade", () => {
  // Bundles are presentation-only in conflict logic — the scanner only
  // cares about each module's EFFECTIVE enabled state, which walks the
  // parent_uid chain via isModuleEffectivelyEnabled. These tests assert
  // the cascade actually fires for tier-2 (parent_uid chain depth 1).

  it("disabled outer bundle suppresses conflicts on its DIRECT children", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "w1", type: "wildcard", enabled: true,
          meta: { name: "a" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "outer-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
        {
          id: "w2", type: "wildcard", enabled: true,
          meta: { name: "b" }, entries: [],
          payload: { var_binding: "style", options: [] }, // would dup
          bundle_origin: "outer-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
      ],
      bundles: [{
        _uid: "outer-u", library_id: "lib-outer",
        start_idx: 0, end_idx: 1,
        enabled: false, collapsed: false, inserted_at_hash: "h",
        name: "Outer", color: null, parent_uid: null,
      }],
    };
    // Outer disabled → both children effectively disabled → no duplicate.
    const out = scanConflicts(value, []);
    expect(out.filter((c) => c.type === "duplicate_variable")).toEqual([]);
  });

  it("disabled outer cascades to INNER bundle's leaves", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "w1", type: "wildcard", enabled: true,
          meta: { name: "a" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "inner-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
        {
          id: "w2", type: "wildcard", enabled: true,
          meta: { name: "b" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "inner-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
      ],
      bundles: [
        {
          _uid: "outer-u", library_id: "lib-outer",
          start_idx: 0, end_idx: 1,
          enabled: false, collapsed: false, inserted_at_hash: "h",
          name: "Outer", color: null, parent_uid: null,
        },
        {
          _uid: "inner-u", library_id: "lib-inner",
          start_idx: 0, end_idx: 1,
          enabled: true, collapsed: false, inserted_at_hash: "h",
          name: "Inner", color: null, parent_uid: "outer-u",
        },
      ],
    };
    // Inner's own enabled is TRUE but outer is FALSE → cascade disables
    // both inner leaves → no duplicate flagged.
    const out = scanConflicts(value, []);
    expect(out.filter((c) => c.type === "duplicate_variable")).toEqual([]);
  });

  it("enabled outer + disabled inner: inner leaves suppressed, outer leaf still scanned", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "w-outer", type: "wildcard", enabled: true,
          meta: { name: "outer-leaf" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "outer-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
        {
          id: "w-inner", type: "wildcard", enabled: true,
          meta: { name: "inner-leaf" }, entries: [],
          payload: { var_binding: "style", options: [] }, // would dup with w-outer
          bundle_origin: "inner-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
      ],
      bundles: [
        {
          _uid: "outer-u", library_id: "lib-outer",
          start_idx: 0, end_idx: 1,
          enabled: true, collapsed: false, inserted_at_hash: "h",
          name: "Outer", color: null, parent_uid: null,
        },
        {
          _uid: "inner-u", library_id: "lib-inner",
          start_idx: 1, end_idx: 1,
          enabled: false, collapsed: false, inserted_at_hash: "h",
          name: "Inner", color: null, parent_uid: "outer-u",
        },
      ],
    };
    // Inner disabled suppresses w-inner → no duplicate (only w-outer
    // effectively enabled writing `$style`).
    const out = scanConflicts(value, []);
    expect(out.filter((c) => c.type === "duplicate_variable")).toEqual([]);
  });

  it("cross-bundle duplicate flagged when both bundles enabled", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        {
          id: "w-outer", type: "wildcard", enabled: true,
          meta: { name: "outer-leaf" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "outer-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
        {
          id: "w-inner", type: "wildcard", enabled: true,
          meta: { name: "inner-leaf" }, entries: [],
          payload: { var_binding: "style", options: [] },
          bundle_origin: "inner-u",
        } as ContextWidgetValue["modules"][number] & { bundle_origin?: string },
      ],
      bundles: [
        {
          _uid: "outer-u", library_id: "lib-outer",
          start_idx: 0, end_idx: 1,
          enabled: true, collapsed: false, inserted_at_hash: "h",
          name: "Outer", color: null, parent_uid: null,
        },
        {
          _uid: "inner-u", library_id: "lib-inner",
          start_idx: 1, end_idx: 1,
          enabled: true, collapsed: false, inserted_at_hash: "h",
          name: "Inner", color: null, parent_uid: "outer-u",
        },
      ],
    };
    const out = scanConflicts(value, []);
    const dupes = out.filter((c) => c.type === "duplicate_variable");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ variable: "style" });
  });
});

describe("scanConflicts — first-instance orphan + count check (2026-05-24)", () => {
  it("2 constraints + 1 downstream target → second is orphan", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
        constraint("c2", "aaaa1111", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    const orphans = out.filter((c) => c.type === "constraint_orphan_target");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].moduleId).toBe("c2");
  });

  it("2 constraints + 2 downstream targets → no orphan", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
        constraint("c2", "aaaa1111", "bbbb2222"),
        wildcard("bbbb2222", "outfit"),
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, [], ["aaaa1111"]);
    expect(out.filter((c) => c.type === "constraint_orphan_target")).toHaveLength(0);
  });

  it("constraint with source ONLY downstream flags orphan_source", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        constraint("c1", "aaaa1111", "bbbb2222"),
        wildcard("aaaa1111", "hair"),  // source AFTER constraint
        wildcard("bbbb2222", "outfit"),
      ],
    };
    const out = scanConflicts(value, []);
    expect(out.find((c) => c.type === "constraint_orphan_source"))
      .toMatchObject({ moduleId: "c1", variable: "aaaa1111" });
  });
});
