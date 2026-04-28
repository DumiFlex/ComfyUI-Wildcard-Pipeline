import { describe, expect, it } from "vitest";
import {
  buildFilteredBundle,
  bundleSizeBytes,
  canonicalJson,
  classifyCategory,
  classifyModule,
  formatBytes,
  GROUPS,
  hashPayload,
  presetFavoritesOnly,
  presetFull,
  presetWildcardsOnly,
  selectionCounts,
  selectionKey,
} from "../utils/bundleSelection";
import type { CategoryRow, ModuleRow } from "../api/types";

function mkModule(over: Partial<ModuleRow>): ModuleRow {
  return {
    id: "wc_aaaa1111",
    uuid: "aabbccdd",
    type: "wildcard",
    name: "Sample",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {},
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

function mkCategory(over: Partial<CategoryRow>): CategoryRow {
  return {
    id: "cat_a",
    name: "Style",
    color: "#a78bfa",
    icon: null,
    sort_order: 0,
    ...over,
  };
}

describe("bundleSelection — selection key", () => {
  it("formats `<group>:<id>`", () => {
    expect(selectionKey("wildcard", "wc_x")).toBe("wildcard:wc_x");
    expect(selectionKey("category", "cat_a")).toBe("category:cat_a");
  });
});

describe("bundleSelection — GROUPS", () => {
  it("includes a category pseudo-group with type=null", () => {
    const cat = GROUPS.find((g) => g.key === "category");
    expect(cat).toBeDefined();
    expect(cat?.type).toBeNull();
  });
});

describe("bundleSelection — buildFilteredBundle", () => {
  const modules = [
    mkModule({ id: "wc_a", type: "wildcard", category_id: "cat_a" }),
    mkModule({ id: "fv_b", type: "fixed_values", category_id: "cat_b" }),
    mkModule({ id: "cb_c", type: "combine", category_id: null }),
  ];
  const categories = [
    mkCategory({ id: "cat_a", name: "Style" }),
    mkCategory({ id: "cat_b", name: "Lighting" }),
    mkCategory({ id: "cat_z", name: "Unused" }),
  ];

  it("filters modules by selection set", () => {
    const sel = new Set<string>([
      selectionKey("wildcard", "wc_a"),
      selectionKey("combine", "cb_c"),
    ]);
    const bundle = buildFilteredBundle({ modules, categories, selected: sel });
    expect(bundle.modules.map((m) => m.id).sort()).toEqual(["cb_c", "wc_a"]);
  });

  it("auto-includes referenced categories even when not explicitly checked", () => {
    const sel = new Set<string>([selectionKey("wildcard", "wc_a")]);
    const bundle = buildFilteredBundle({ modules, categories, selected: sel });
    expect(bundle.categories.map((c) => c.id)).toEqual(["cat_a"]);
  });

  it("respects explicit category checks even with no module references", () => {
    const sel = new Set<string>([selectionKey("category", "cat_z")]);
    const bundle = buildFilteredBundle({ modules, categories, selected: sel });
    expect(bundle.categories.map((c) => c.id)).toEqual(["cat_z"]);
    expect(bundle.modules).toHaveLength(0);
  });

  it("merges referenced + explicitly checked categories without duplicates", () => {
    const sel = new Set<string>([
      selectionKey("wildcard", "wc_a"),     // refs cat_a
      selectionKey("category", "cat_a"),    // explicit
      selectionKey("category", "cat_z"),    // explicit
    ]);
    const bundle = buildFilteredBundle({ modules, categories, selected: sel });
    expect(bundle.categories.map((c) => c.id).sort()).toEqual(["cat_a", "cat_z"]);
  });

  it("sets bundle version=1 and includes exported_at timestamp", () => {
    const bundle = buildFilteredBundle({
      modules: [], categories: [], selected: new Set(),
    });
    expect(bundle.version).toBe(1);
    expect(typeof bundle.exported_at).toBe("string");
  });
});

describe("bundleSelection — bundleSizeBytes", () => {
  it("matches JSON.stringify(...).length", () => {
    const bundle = buildFilteredBundle({
      modules: [mkModule({ id: "wc_a" })],
      categories: [mkCategory({ id: "cat_a" })],
      selected: new Set([
        selectionKey("wildcard", "wc_a"),
        selectionKey("category", "cat_a"),
      ]),
    });
    expect(bundleSizeBytes(bundle)).toBe(JSON.stringify(bundle).length);
  });

  it("formatBytes produces human-readable strings", () => {
    expect(formatBytes(123)).toBe("123 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024 * 3)).toBe("3.00 MB");
  });
});

describe("bundleSelection — presets", () => {
  const modules = [
    mkModule({ id: "wc_a", type: "wildcard", is_favorite: true }),
    mkModule({ id: "wc_b", type: "wildcard", is_favorite: false }),
    mkModule({ id: "fv_a", type: "fixed_values", is_favorite: true }),
    mkModule({ id: "cb_a", type: "combine", is_favorite: false }),
  ];
  const categories = [mkCategory({ id: "cat_a" })];

  it("Full library — selects every module + every category", () => {
    const sel = presetFull(modules, categories);
    expect(sel.size).toBe(modules.length + categories.length);
    expect(sel.has("wildcard:wc_a")).toBe(true);
    expect(sel.has("category:cat_a")).toBe(true);
  });

  it("Wildcards only — selects exactly wildcards (no fixed_values/combines)", () => {
    const sel = presetWildcardsOnly(modules);
    expect(Array.from(sel).sort()).toEqual(["wildcard:wc_a", "wildcard:wc_b"]);
  });

  it("Favorites only — selects every favorited module across kinds", () => {
    const sel = presetFavoritesOnly(modules);
    expect(Array.from(sel).sort()).toEqual([
      "fixed_values:fv_a", "wildcard:wc_a",
    ]);
  });
});

describe("bundleSelection — selectionCounts", () => {
  it("counts per group + total", () => {
    const sel = new Set([
      "wildcard:wc_a", "wildcard:wc_b",
      "fixed_values:fv_a",
      "category:cat_a",
    ]);
    const c = selectionCounts(sel);
    expect(c.wildcard).toBe(2);
    expect(c.fixed_values).toBe(1);
    expect(c.combine).toBe(0);
    expect(c.category).toBe(1);
    expect(c.total).toBe(4);
  });
});

describe("bundleSelection — canonicalJson + hashPayload", () => {
  it("canonicalJson is order-insensitive", () => {
    const a = canonicalJson({ b: 1, a: 2 });
    const b = canonicalJson({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("hashPayload differs when payloads differ", () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it("hashPayload is stable across key reorderings", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
});

describe("bundleSelection — classifyModule", () => {
  it("returns `new` when id is unknown locally", () => {
    const local = new Map<string, ModuleRow>();
    const incoming = mkModule({ id: "wc_new", payload: { x: 1 } });
    expect(classifyModule(incoming, local).kind).toBe("new");
  });

  it("returns `exists` when payload is identical", () => {
    const existing = mkModule({ id: "wc_a", payload: { foo: 1 } });
    const local = new Map<string, ModuleRow>([[existing.id, existing]]);
    const incoming = mkModule({ id: "wc_a", payload: { foo: 1 } });
    const r = classifyModule(incoming, local);
    expect(r.kind).toBe("exists");
    expect(r.existingId).toBe("wc_a");
  });

  it("returns `modified` when id matches but payload diverges", () => {
    const existing = mkModule({ id: "wc_a", payload: { foo: 1 } });
    const local = new Map<string, ModuleRow>([[existing.id, existing]]);
    const incoming = mkModule({ id: "wc_a", payload: { foo: 2 } });
    const r = classifyModule(incoming, local);
    expect(r.kind).toBe("modified");
    expect(r.existingId).toBe("wc_a");
  });
});

describe("bundleSelection — classifyCategory", () => {
  it("returns `new` when id is unknown locally", () => {
    const r = classifyCategory(mkCategory({ id: "cat_z" }), new Map());
    expect(r.kind).toBe("new");
  });

  it("returns `modified` when name or color differs", () => {
    const existing = mkCategory({ id: "cat_a", color: "#aaaaaa" });
    const local = new Map([[existing.id, existing]]);
    const r = classifyCategory(mkCategory({ id: "cat_a", color: "#bbbbbb" }), local);
    expect(r.kind).toBe("modified");
  });
});
