import { describe, expect, it } from "vitest";
import type { BundleRow, ModuleRow, ScenarioRunResponse } from "../api/types";
import { distribution, inspectItem, reachLabel } from "./inspect";

function mod(id: string, type: ModuleRow["type"], name: string, payload: Record<string, unknown>): ModuleRow {
  return {
    id, type, name, description: "", category_id: null, tags: [], is_favorite: false,
    payload, payload_hash: "0".repeat(64), version: 1, created_at: "", updated_at: "",
  } as ModuleRow;
}

const HAIR = mod("aabbccdd", "wildcard", "Hair", {
  var_binding: "hair",
  options: [
    { id: "o1", value: "red", weight: 3 },
    { id: "o2", value: "black", weight: 1 },
    { id: "o3", value: "", weight: 0, is_null: true },
  ],
});
const OUTFIT = mod("bbbbbbbb", "wildcard", "Outfit", { var_binding: "outfit", options: [] });
const CONSTR = mod("cccccccc", "constraint", "Hair x Outfit", {
  source_wildcard_id: "aabbccdd", target_wildcard_id: "bbbbbbbb",
  exceptions: [{}], matrix: { soft: { bold: { mode: "boost" }, calm: { mode: "exclude" } } },
  target_select: { mode: "next", count: 2 },
});
const SCENE = mod("dddddddd", "combine", "Scene", { template: "$hair hair, $outfit", output_var: "scene" });
const DERIV = mod("eeeeeeee", "derivation", "Light", {
  rules: [{
    branches: [{ condition: { var: "hair", op: "equals", value: "red" }, action: { target_var: "light", mode: "replace", value: "warm" } }],
    else: { action: { target_var: "light", mode: "append", value: " cool" } },
  }],
});
const FIXED = mod("ffffffff", "fixed_values", "Profile", { values: [{ id: "v1", name: "name", value: "Mira" }] });
const MODULES = [HAIR, OUTFIT, CONSTR, SCENE, DERIV, FIXED];
const BUNDLE = {
  id: "b1", name: "Look",
  children: [
    { type: "wildcard", name: "Hair", payload: { var_binding: "hair", options: [] } },
    { type: "bundle", name: "Inner", children: [{ type: "combine", meta: { name: "Scene" }, payload: { output_var: "scene" } }] },
  ],
} as unknown as BundleRow;

function result(extra: Partial<ScenarioRunResponse> = {}): ScenarioRunResponse {
  return {
    runs: 10, failed: 0, elapsed_ms: 1, seeds: { first: 0, count: 10 },
    variables: {
      hair: { counts: { red: 10 }, distinct: 1, other: 0, internal: false },
      scene: { counts: { "red hair, hat": 6, "red hair, cap": 4 }, distinct: 2, other: 0, internal: false },
      light: { counts: { warm: 10 }, distinct: 1, other: 0, internal: false },
    },
    picks: { aabbccdd: { o1: 10 } },
    constraint_hits: { cccccccc: 7 },
    warnings: [], samples: [], missing: [], pins: {},
    stack: [
      { index: 0, kind: "module", id: "aabbccdd", name: "Hair", type: "wildcard", uids: ["s0"] },
      { index: 1, kind: "module", id: "cccccccc", name: "Hair x Outfit", type: "constraint", uids: ["s1"] },
      { index: 2, kind: "module", id: "dddddddd", name: "Scene", type: "combine", uids: ["s2"] },
      { index: 3, kind: "module", id: "eeeeeeee", name: "Light", type: "derivation", uids: ["s3"] },
      { index: 4, kind: "bundle", id: "b1", name: "Look", type: "bundle", uids: ["s4.0", "s4.1.0"] },
    ],
    ...extra,
  };
}

const item = (kind: string, id: string) => ({ kind, id });

describe("inspectItem", () => {
  it("puts a wildcard's weight shares next to its picks", () => {
    const d = inspectItem(item("wildcard", HAIR.id), 0, MODULES, [BUNDLE], result());
    expect(d).toMatchObject({ kind: "wildcard", binding: "hair", totalPicks: 10, neverPicked: 1 });
    if (d?.kind !== "wildcard") throw new Error("kind");
    expect(d.options.map((o) => [o.value, o.weightPct, o.picks, o.pickPct, o.isNull])).toEqual([
      ["red", 75, 10, 100, false],
      ["black", 25, 0, 0, false],
      ["", 0, 0, 0, true],
    ]);
  });

  it("leaves picks empty when there's no run, or the run's stack no longer lines up", () => {
    const none = inspectItem(item("wildcard", HAIR.id), 0, MODULES, [], null);
    const moved = inspectItem(item("wildcard", HAIR.id), 1, MODULES, [], result());
    for (const d of [none, moved]) {
      expect(d).toMatchObject({ kind: "wildcard", totalPicks: null, neverPicked: 0 });
      if (d?.kind === "wildcard") expect(d.options[0].picks).toBeNull();
    }
  });

  it("describes a constraint's link, reach, rules and hits", () => {
    expect(inspectItem(item("constraint", CONSTR.id), 1, MODULES, [], result())).toEqual({
      kind: "constraint", source: "$hair", target: "$outfit", reach: "the next 2 picks", rules: 3, hits: 7, runs: 10,
    });
    const quiet = inspectItem(item("constraint", CONSTR.id), 1, MODULES, [], result({ constraint_hits: {} }));
    expect(quiet).toMatchObject({ hits: 0 });
  });

  it("shows a combine's template, reads and output values", () => {
    const d = inspectItem({ ...item("combine", SCENE.id), fixedText: false }, 2, MODULES, [], result());
    expect(d).toMatchObject({ kind: "combine", output: "scene", reads: ["hair", "outfit"], fixed: false });
    if (d?.kind !== "combine") throw new Error("kind");
    expect(d.distribution?.rows).toEqual([
      { value: "red hair, hat", count: 6, pct: 60 },
      { value: "red hair, cap", count: 4, pct: 40 },
    ]);
  });

  it("spells out derivation rules and the target's values", () => {
    const d = inspectItem(item("derivation", DERIV.id), 3, MODULES, [], result());
    expect(d).toMatchObject({
      kind: "derivation",
      rules: [
        { when: 'if $hair equals "red"', then: '$light = "warm"' },
        { when: "else", then: '$light += " cool"' },
      ],
    });
    if (d?.kind === "derivation") expect(d.distributions.map((x) => x.name)).toEqual(["light"]);
  });

  it("describes an \"Add to negative\" action without claiming a value write", () => {
    const neg = mod("acacacac", "derivation", "Mood neg", {
      rules: [{ branches: [{
        condition: { var: "mood", op: "equals", value: "gloomy" },
        action: { target_var: "mood", mode: "negative", value: "bright colors, smiling" },
      }] }],
    });
    const d = inspectItem(item("derivation", neg.id), 0, [neg], [], null);
    expect(d).toMatchObject({ rules: [{ then: 'negative($mood) += "bright colors, smiling"' }] });
  });

  it("spells out AND / OR condition groups", () => {
    const grouped = mod("abababab", "derivation", "Weather", {
      rules: [{ branches: [{
        condition: { match: "all", conditions: [
          { var: "time", op: "equals", value: "night" },
          { match: "any", conditions: [{ var: "sky", op: "equals", value: "rain" }, { var: "sky", op: "equals", value: "fog" }] },
        ] },
        action: { target_var: "light", mode: "replace", value: "dim" },
      }] }],
    });
    const d = inspectItem(item("derivation", grouped.id), 0, [grouped], [], null);
    expect(d).toMatchObject({ rules: [{ when: 'if $time equals "night" AND ($sky equals "rain" OR $sky equals "fog")' }] });
  });

  it("lists fixed values and bundle children, nested ones indented", () => {
    expect(inspectItem(item("fixed_values", FIXED.id), 5, MODULES, [], null)).toEqual({
      kind: "fixed_values", values: [{ name: "name", value: "Mira" }],
    });
    const b = inspectItem(item("bundle", "b1"), 4, MODULES, [BUNDLE], result());
    expect(b).toMatchObject({
      kind: "bundle",
      children: [
        { kind: "wildcard", name: "Hair", binding: "hair", depth: 0 },
        { kind: "bundle", name: "Inner", binding: "", depth: 0 },
        { kind: "combine", name: "Scene", binding: "scene", depth: 1 },
      ],
    });
    if (b?.kind === "bundle") expect(b.distributions.map((x) => x.name)).toEqual(["hair", "scene"]);
  });

  it("returns null for items gone from the library", () => {
    expect(inspectItem(item("wildcard", "gone"), 0, MODULES, [], null)).toBeNull();
    expect(inspectItem(item("bundle", "gone"), 0, MODULES, [], null)).toBeNull();
  });
});

describe("reachLabel / distribution", () => {
  it("words every reach mode", () => {
    expect(reachLabel(undefined)).toBe("every later pick");
    expect(reachLabel({ mode: "first" })).toBe("the first pick");
    expect(reachLabel({ mode: "next", count: 1 })).toBe("the next pick");
    expect(reachLabel({ mode: "pick", picks: [{}, {}] })).toBe("2 chosen picks");
  });

  it("trims to the top values and counts the rest as other", () => {
    const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`v${i}`, 10 - i]));
    const r = result({ runs: 55, variables: { x: { counts, distinct: 10, other: 0, internal: false } } });
    const d = distribution(r, "x");
    expect(d?.rows).toHaveLength(8);
    expect(d?.other).toBe(2 + 1);
    expect(distribution(r, "missing")).toBeNull();
  });
});
