import { describe, expect, it } from "vitest";
import {
  applyDiff, buildIndex, categoryRefsTo, combineVarRefsTo,
  optionRefsTo, refsTo, subcatRefsTo,
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

  it("indexes option_id refs from constraint exceptions", () => {
    const exLib: LibraryFixture = {
      wildcards: [{
        id: "11111111", name: "hair",
        payload: { sub_categories: [], options: [
          { id: "opt_aaaa", value: "buzz", sub_category: null },
        ] },
      }],
      constraints: [{
        id: "ddddd111", name: "c",
        payload: {
          source_wildcard_id: "11111111",
          target_wildcard_id: "11111111",
          matrix: {},
          exceptions: [{
            source: "buzz", target: "buzz",
            source_id: "opt_aaaa", target_id: "opt_aaaa",
            mode: "reduce", factor: 0.5,
          }],
        },
      }],
      fixed_values: [], combines: [], derivations: [], bundles: [], categories: [],
    };
    const idx = buildIndex(exLib);
    const refs = optionRefsTo(idx, "opt_aaaa");
    expect(refs).toHaveLength(1);
    expect(refs[0].from_kind).toBe("constraint");
    expect(refs[0].from_id).toBe("ddddd111");
    expect(refs[0].ref_path).toContain("source_id");
  });

  it("applyDiff drops option_id entry on remove_option", () => {
    const exLib: LibraryFixture = {
      wildcards: [{
        id: "11111111", name: "hair",
        payload: { sub_categories: [], options: [
          { id: "opt_aaaa", value: "buzz", sub_category: null },
        ] },
      }],
      constraints: [{
        id: "ddddd111", name: "c",
        payload: {
          source_wildcard_id: "11111111",
          target_wildcard_id: "11111111",
          matrix: {},
          exceptions: [{
            source_id: "opt_aaaa", target_id: "opt_aaaa",
            source: "buzz", target: "buzz",
            mode: "reduce", factor: 0.5,
          }],
        },
      }],
      fixed_values: [], combines: [], derivations: [], bundles: [], categories: [],
    };
    const idx = buildIndex(exLib);
    expect(optionRefsTo(idx, "opt_aaaa")).toHaveLength(1);
    applyDiff(idx, [{ entity_id: "11111111", remove_option: "opt_aaaa" }]);
    expect(optionRefsTo(idx, "opt_aaaa")).toHaveLength(0);
  });

  it("matrix target-side subcat ref deduped per constraint", () => {
    // Constraint with N source rows that all mention the same target
    // subcat used to push N refs, double-counting the badge.
    const dupLib: LibraryFixture = {
      wildcards: [
        { id: "11111111", name: "src", payload: { sub_categories: ["a", "b"], options: [] } },
        { id: "22222222", name: "tgt", payload: { sub_categories: ["x", "y"], options: [] } },
      ],
      constraints: [
        {
          id: "cccccc11", name: "c",
          payload: {
            source_wildcard_id: "11111111", target_wildcard_id: "22222222",
            matrix: {
              a: { x: { mode: "allow" }, y: { mode: "block" } },
              b: { x: { mode: "block" }, y: { mode: "allow" } },
            },
            exceptions: [],
          },
        },
      ],
      fixed_values: [], combines: [], derivations: [], bundles: [], categories: [],
    };
    const idx = buildIndex(dupLib);
    // Each target subcat should be referenced ONCE per constraint even
    // though both source rows mention it.
    expect(subcatRefsTo(idx, "22222222", "x")).toHaveLength(1);
    expect(subcatRefsTo(idx, "22222222", "y")).toHaveLength(1);
    // Source side is naturally unique (one row per key).
    expect(subcatRefsTo(idx, "11111111", "a")).toHaveLength(1);
    expect(subcatRefsTo(idx, "11111111", "b")).toHaveLength(1);
  });

  it("applyDiff renames subcat keys atomically (live badge update)", () => {
    const idx = buildIndex(lib);
    expect(subcatRefsTo(idx, "11111111", "warm")).toHaveLength(2);
    expect(subcatRefsTo(idx, "11111111", "hot")).toHaveLength(0);
    applyDiff(idx, [
      {
        entity_id: "dddddd11",
        rename_ref: { kind: "subcat", wildcard_id: "11111111", old: "warm", new: "hot" },
      },
    ]);
    expect(subcatRefsTo(idx, "11111111", "warm")).toHaveLength(0);
    expect(subcatRefsTo(idx, "11111111", "hot")).toHaveLength(2);
  });

  it("applyDiff renames combine var keys (toCombineVar + toFixedValueName)", () => {
    const varLib: LibraryFixture = {
      wildcards: [
        {
          id: "11111111", name: "w",
          payload: { options: [{ id: "o1", value: "uses $mood", weight: 1 }] },
        },
      ],
      combines: [
        { id: "cccccc11", name: "c", payload: { template: "$mood + $tone" } },
      ],
      fixed_values: [], derivations: [], constraints: [], bundles: [], categories: [],
    };
    const idx = buildIndex(varLib);
    expect(combineVarRefsTo(idx, "mood").length).toBeGreaterThan(0);
    applyDiff(idx, [
      { entity_id: "cccccc11", rename_ref: { kind: "var", old: "mood", new: "vibe" } },
    ]);
    expect(combineVarRefsTo(idx, "mood")).toHaveLength(0);
    expect(combineVarRefsTo(idx, "vibe").length).toBeGreaterThan(0);
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
