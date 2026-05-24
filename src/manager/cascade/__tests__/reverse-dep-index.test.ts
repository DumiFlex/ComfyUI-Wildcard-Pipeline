import { describe, expect, it } from "vitest";
import {
  applyDiff, buildIndex, categoryRefsTo, combineVarRefsTo,
  refsTo, subcatRefsTo,
  type LibraryFixture,
} from "../reverse-dep-index";

const lib: LibraryFixture = {
  wildcards: [
    { id: "11111111", name: "palette", payload: { options: [
      { id: "o1", value: "red", weight: 1, sub_categories: ["warm"] },
    ] } },
    { id: "22222222", name: "user", payload: { options: [
      { id: "u1", value: "see @{11111111:warm} now", weight: 1 },
    ] } },
  ],
  combines: [
    { id: "ccccc111", name: "c1", payload: { template: "uses $mood", output_var: "tone" } },
  ],
  fixed_values: [],
  derivations: [],
  constraints: [
    { id: "dddddd11", name: "c", payload: {
      source_wildcard_id: "11111111", target_wildcard_id: "22222222",
      matrix: { warm: { a: { mode: "block" } } }, exceptions: [],
    } },
  ],
  bundles: [
    { id: "bbbbbb11", name: "b1", children: [{ id: "11111111", type: "module" }] },
  ],
  categories: [],
};

describe("reverse-dep-index", () => {
  it("captures wildcard text refs as incoming refs on target wildcard", () => {
    const idx = buildIndex(lib);
    const incoming = refsTo(idx, "wildcard", "11111111");
    expect(incoming.some((r) => r.from_id === "22222222")).toBe(true);
  });

  it("captures subcat refs from constraint matrix + text", () => {
    const idx = buildIndex(lib);
    const incoming = subcatRefsTo(idx, "11111111", "warm");
    const fromIds = incoming.map((r) => r.from_id);
    expect(fromIds).toContain("dddddd11");
    expect(fromIds).toContain("22222222");
  });

  it("captures combine var refs from combine template + wildcard text", () => {
    const idx = buildIndex(lib);
    const incoming = combineVarRefsTo(idx, "mood");
    expect(incoming.map((r) => r.from_id)).toContain("ccccc111");
  });

  it("captures bundle child as entity ref", () => {
    const idx = buildIndex(lib);
    const incoming = refsTo(idx, "wildcard", "11111111");
    expect(incoming.some((r) => r.from_kind === "bundle" && r.from_id === "bbbbbb11")).toBe(true);
  });

  it("applyDiff removes a subcat ref incrementally", () => {
    const idx = buildIndex(lib);
    expect(subcatRefsTo(idx, "11111111", "warm").length).toBeGreaterThan(0);
    applyDiff(idx, [
      { entity_id: "dddddd11", remove_ref: { kind: "subcat", wildcard_id: "11111111", name: "warm" } },
      { entity_id: "22222222", remove_ref: { kind: "subcat", wildcard_id: "11111111", name: "warm" } },
    ]);
    expect(subcatRefsTo(idx, "11111111", "warm")).toHaveLength(0);
  });

  it("applyDiff removes whole entity (removed: true)", () => {
    const idx = buildIndex(lib);
    expect(refsTo(idx, "wildcard", "11111111").length).toBeGreaterThan(0);
    applyDiff(idx, [{ entity_id: "22222222", removed: true }]);
    expect(refsTo(idx, "wildcard", "11111111").every((r) => r.from_id !== "22222222")).toBe(true);
  });

  it("category refs collected from category_id field", () => {
    const idxLib: LibraryFixture = {
      wildcards: [{ id: "11111111", name: "w", payload: { options: [] }, category_id: "cat1" }],
      fixed_values: [], combines: [], derivations: [],
      constraints: [], bundles: [], categories: [{ id: "cat1", name: "Style" }],
    };
    const idx = buildIndex(idxLib);
    expect(categoryRefsTo(idx, "cat1").length).toBe(1);
  });
});
