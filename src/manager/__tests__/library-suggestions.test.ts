import { describe, it, expect } from "vitest";
import { buildWildcardRefData } from "../utils/library-suggestions";
import type { ModuleRow } from "../api/types";

/** Minimal catalog: one fully-specified wildcard, one bare wildcard, and a
 *  non-wildcard row that must be ignored entirely. */
function catalog(): ModuleRow[] {
  return [
    {
      id: "aaaaaaaa",
      type: "wildcard",
      name: "Color Mood",
      payload: {
        var_binding: "mood",
        sub_categories: ["warm", "cold"],
        tag_groups: { temp: ["warm", "cold"] },
        options: [
          { value: "calm", sub_categories: ["cold"] },
          { value: "", is_null: true },
          { value: "rage", sub_categories: ["warm", "intense"] },
        ],
      },
    },
    { id: "bbbbbbbb", type: "wildcard", name: "Bare One", payload: {} },
    { id: "cccccccc", type: "combine", name: "ignore", payload: { output_var: "x" } },
  ] as unknown as ModuleRow[];
}

describe("buildWildcardRefData", () => {
  it("only includes wildcard rows; non-wildcard rows never appear in any map", () => {
    const d = buildWildcardRefData(catalog());
    for (const m of [
      d.uuidToName,
      d.uuidToSubCategories,
      d.uuidToHasNull,
      d.uuidToOptionsCount,
      d.uuidToOptionTagSets,
      d.uuidToTagGroups,
    ]) {
      expect(m.has("cccccccc")).toBe(false);
      expect(m.has("aaaaaaaa")).toBe(true);
      expect(m.has("bbbbbbbb")).toBe(true);
    }
  });

  it("uuidToName = var_binding when set, else a non-empty slug of the name", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToName.get("aaaaaaaa")).toBe("mood");
    expect((d.uuidToName.get("bbbbbbbb") ?? "").length).toBeGreaterThan(0);
  });

  it("uuidToSubCategories: declared list (strings only) or [] when absent", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToSubCategories.get("aaaaaaaa")).toEqual(["warm", "cold"]);
    expect(d.uuidToSubCategories.get("bbbbbbbb")).toEqual([]);
  });

  it("uuidToOptionsCount counts all options incl. null", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToOptionsCount.get("aaaaaaaa")).toBe(3);
    expect(d.uuidToOptionsCount.get("bbbbbbbb")).toBe(0);
  });

  it("uuidToHasNull true iff some option is_null", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToHasNull.get("aaaaaaaa")).toBe(true);
    expect(d.uuidToHasNull.get("bbbbbbbb")).toBe(false);
  });

  it("uuidToOptionTagSets = non-null options' sub_categories", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToOptionTagSets.get("aaaaaaaa")).toEqual([["cold"], ["warm", "intense"]]);
    expect(d.uuidToOptionTagSets.get("bbbbbbbb")).toEqual([]);
  });

  it("uuidToTagGroups = payload.tag_groups or {}", () => {
    const d = buildWildcardRefData(catalog());
    expect(d.uuidToTagGroups.get("aaaaaaaa")).toEqual({ temp: ["warm", "cold"] });
    expect(d.uuidToTagGroups.get("bbbbbbbb")).toEqual({});
  });
});
