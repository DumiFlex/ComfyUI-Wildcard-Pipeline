import { describe, expect, it } from "vitest";
import type { BundleRow, ModuleRow, ScenarioRunResponse } from "../api/types";
import {
  defaultOutputVar,
  describeItem,
  lastRunSummary,
  moduleBinding,
  orderByStack,
  renderValue,
  searchText,
  seedLabel,
  segmentOutput,
  summarizeVariables,
  type StackItemView,
  moduleReads,
  moduleWrites,
  unsetReads,
  isFixedTemplate,
} from "./scenario";

function mod(id: string, type: ModuleRow["type"], name: string, payload: Record<string, unknown>): ModuleRow {
  return {
    id, type, name, description: "", category_id: null, tags: [], is_favorite: false,
    payload, payload_hash: "0".repeat(64), version: 1, created_at: "", updated_at: "",
  } as ModuleRow;
}

const HAIR = mod("aabbccdd", "wildcard", "Hair Color", { options: [], var_binding: "hair" });
const OUTFIT = mod("bbbbbbbb", "wildcard", "Outfit Style", { options: [] });
const FIXED = mod("cccccccc", "fixed_values", "Profile", { values: [{ var: "name", value: "Mira" }] });
const PROMPT = mod("dddddddd", "combine", "Prompt", { template: "$name, $hair", output_var: "$prompt" });
const DERIV = mod("eeeeeeee", "derivation", "Mood", {
  rules: [{ branches: [{ action: { target_var: "mood", mode: "set", value: "calm" } }] }],
});
const CONSTR = mod("ffffffff", "constraint", "Hair x Outfit", {
  source_wildcard_id: "aabbccdd", target_wildcard_id: "bbbbbbbb",
});
const MODULES = [HAIR, OUTFIT, FIXED, PROMPT, DERIV, CONSTR];
const BUNDLES = [{ id: "b1", name: "Look", children: [{}, {}, {}] } as unknown as BundleRow];

function view(kind: StackItemView["kind"], binding: string, extra: Partial<StackItemView> = {}): StackItemView {
  return { kind, id: binding, name: binding, binding, detail: "", enabled: true, missing: false, ...extra };
}

describe("moduleBinding", () => {
  it("reads each kind's written variable", () => {
    expect(moduleBinding(HAIR)).toBe("hair");
    expect(moduleBinding(OUTFIT)).toBe("outfit_style");
    expect(moduleBinding(PROMPT)).toBe("prompt");
    expect(moduleBinding(DERIV)).toBe("mood");
    expect(moduleBinding(FIXED)).toBe("");
  });
});

describe("describeItem", () => {
  it("describes modules by kind", () => {
    expect(describeItem({ module: "cccccccc" }, MODULES, BUNDLES).detail).toBe("1 value");
    expect(describeItem({ module: "ffffffff" }, MODULES, BUNDLES).detail).toBe("hair → outfit_style");
    expect(describeItem({ module: "eeeeeeee" }, MODULES, BUNDLES).detail).toBe("→ $mood");
    expect(describeItem({ module: "aabbccdd", enabled: false }, MODULES, BUNDLES)).toMatchObject({
      kind: "wildcard", name: "Hair Color", binding: "hair", detail: "$hair", enabled: false, missing: false,
    });
  });

  it("describes bundles and flags deleted items", () => {
    expect(describeItem({ bundle: "b1" }, MODULES, BUNDLES)).toMatchObject({ kind: "bundle", detail: "3 modules" });
    expect(describeItem({ bundle: "gone" }, MODULES, BUNDLES)).toMatchObject({ missing: true, detail: "deleted" });
    expect(describeItem({ module: "12345678" }, MODULES, BUNDLES)).toMatchObject({ missing: true, name: "12345678" });
  });
});

describe("defaultOutputVar", () => {
  it("prefers the last enabled combine", () => {
    expect(defaultOutputVar([view("combine", "a"), view("wildcard", "b"), view("combine", "c", { enabled: false })])).toBe("a");
  });
  it("looks inside bundles, nested ones included", () => {
    const bundles = [
      { id: "in", name: "Inner", children: [{ type: "combine", name: "line", payload: { output_var: "line" } }] },
      { id: "out", name: "Outer", children: [
        { type: "wildcard", meta: { name: "Top Coat" }, payload: {} },
        { type: "bundle", id: "in", children: [{ type: "combine", name: "line", payload: { output_var: "line" } }] },
      ] },
      { id: "wild", name: "Wild", children: [{ type: "wildcard", meta: { name: "Top Coat" }, payload: {} }] },
    ] as unknown as BundleRow[];
    const v = (id: string) => describeItem({ bundle: id }, MODULES, bundles);
    expect(defaultOutputVar([view("wildcard", "a"), v("out")])).toBe("line");
    expect(defaultOutputVar([v("wild")])).toBe("top_coat");
    expect(defaultOutputVar([view("combine", "p"), v("wild")])).toBe("p");
  });
  it("falls back to the last binding, else null", () => {
    expect(defaultOutputVar([view("wildcard", "a"), view("wildcard", "b")])).toBe("b");
    expect(defaultOutputVar([view("fixed_values", "")])).toBeNull();
  });
});

describe("renderValue", () => {
  it("joins multi-picks with their separator", () => {
    expect(renderValue("x")).toBe("x");
    expect(renderValue({ items: ["a", "b"], sep: " and " })).toBe("a and b");
    expect(renderValue(undefined)).toBe("");
  });
});

function result(extra: Partial<ScenarioRunResponse> = {}): ScenarioRunResponse {
  return {
    runs: 4, failed: 0, elapsed_ms: 12, seeds: { first: 0, count: 4 },
    variables: {}, picks: {}, constraint_hits: {}, warnings: [], samples: [], stack: [], missing: [], pins: {},
    ...extra,
  };
}

describe("summarizeVariables", () => {
  it("splits constants from varying variables and sorts by count", () => {
    const r = result({
      variables: {
        name: { counts: { Mira: 4 }, distinct: 1, other: 0, internal: false },
        hair: { counts: { red: 1, black: 3 }, distinct: 2, other: 0, internal: false },
      },
    });
    const { varying, constants } = summarizeVariables(r);
    expect(constants).toEqual([{ name: "name", value: "Mira" }]);
    expect(varying[0].rows).toEqual([
      { value: "black", count: 3, pct: 75 },
      { value: "red", count: 1, pct: 25 },
    ]);
  });
});

describe("orderByStack", () => {
  it("orders names by where the stack writes them", () => {
    expect(orderByStack(["z", "b", "a"], [view("wildcard", "a"), view("wildcard", "b")])).toEqual(["a", "b", "z"]);
  });
});

describe("segmentOutput", () => {
  it("tags the parts another variable wrote", () => {
    const segs = segmentOutput("Mira with black hair", { name: "Mira", hair: "black", prompt: "x" }, "prompt", new Set(["name", "hair"]));
    expect(segs).toEqual([
      { text: "Mira", varName: "name" },
      { text: " with ", varName: null },
      { text: "black", varName: "hair" },
      { text: " hair", varName: null },
    ]);
  });
  it("leaves short or absent values plain", () => {
    expect(segmentOutput("ab", { x: "ab" }, "p", new Set(["x"]))).toEqual([{ text: "ab", varName: null }]);
    expect(segmentOutput("", {}, "p", new Set())).toEqual([{ text: "", varName: null }]);
  });
});

describe("lastRunSummary / seedLabel / searchText", () => {
  it("summarizes a run for the rail", () => {
    const r = result({ failed: 1, warnings: [{ type: "t", message: "m", count: 3, seeds: [1] }] });
    expect(lastRunSummary(r, new Date("2026-01-01T00:00:00Z"))).toEqual({
      runs: 4, failed: 1, warnings: 3, elapsed_ms: 12, ran_at: "2026-01-01T00:00:00.000Z",
    });
  });
  it("labels each seed spec", () => {
    expect(seedLabel({ from: 0, count: 100 })).toBe("seeds 0 to 99");
    expect(seedLabel({ random: true, count: 50 })).toBe("50 random seeds");
    expect(seedLabel({ list: [3] })).toBe("1 listed seed");
  });
  it("searches names and payload strings", () => {
    const text = searchText({ ...PROMPT, tags: ["portrait"] });
    expect(text).toContain("prompt");
    expect(text).toContain("portrait");
    expect(text).toContain("$name, $hair");
  });
});

describe("unsetReads", () => {
  const SHOES = mod("11111111", "wildcard", "shoes", { options: [], var_binding: "shoes" });
  const SCENE = mod("22222222", "combine", "Scene", { template: "wearing $shoes, $outfit.SHOES and $pinned", output_var: "scene" });
  const mods = [SHOES, SCENE, FIXED, DERIV];

  it("reads base names, including axis reads", () => {
    expect(moduleReads(SCENE).sort()).toEqual(["outfit", "pinned", "shoes"]);
    expect(moduleWrites(FIXED)).toEqual(["name"]);
    expect(moduleWrites(DERIV)).toEqual(["mood"]);
  });

  it("flags reads that nothing earlier sets", () => {
    const res = unsetReads([{ module: "22222222" }, { module: "11111111" }], mods, [], { pinned: "x" });
    expect(res).toEqual([["shoes", "outfit"], []]);
  });

  it("counts earlier modules, pins and bundle children as writers", () => {
    const bundles = [{ id: "b2", name: "Look", children: [{ type: "wildcard", name: "outfit", payload: { var_binding: "outfit" } }] } as unknown as BundleRow];
    const res = unsetReads([{ module: "11111111" }, { bundle: "b2" }, { module: "22222222" }], mods, bundles, { $pinned: "x" });
    expect(res).toEqual([[], [], []]);
  });

  it("ignores switched-off items as writers", () => {
    const res = unsetReads([{ module: "11111111", enabled: false }, { module: "22222222" }], mods, [], { pinned: "x", outfit: "y" });
    expect(res[1]).toEqual(["shoes"]);
  });
});

describe("isFixedTemplate", () => {
  const combine = (template: string) => mod("99999999", "combine", "C", { template, output_var: "scene" });
  it("flags a combine whose template is plain text", () => {
    expect(isFixedTemplate(combine("wearing "))).toBe(true);
    expect(describeItem({ module: "99999999" }, [combine("wearing ")], []).fixedText).toBe(true);
  });
  it("treats any syntax as dynamic", () => {
    for (const t of ["wearing $shoes", "a @{aabbccdd}", "{red|blue} hat", "~hat", "__hats__", "[x]"]) {
      expect(isFixedTemplate(combine(t))).toBe(false);
    }
    expect(isFixedTemplate(HAIR)).toBe(false);
    expect(describeItem({ module: "dddddddd" }, MODULES, BUNDLES).fixedText).toBeUndefined();
  });
});
