import { describe, expect, it } from "vitest";
import {
  bundleChildBundleRefs,
  bundleUnmetDependencyRows,
  listReferencedUuids,
  resolveDependencies,
  unmetDependencyRows,
  type ReferencingModule,
} from "../dependencies";
import type { BundleRow, ModuleRow } from "../../api/types";

/** Minimal module-shape builder. `listReferencedUuids` reads only
 *  `id` / `type` / `payload`, so the test fixtures carry just those —
 *  matching the structural intersection of `ModuleRow` and `ModuleEntry`
 *  the helper accepts. */
function mod(parts: Partial<ReferencingModule> & { id: string; type: ReferencingModule["type"] }): ReferencingModule {
  return { payload: {}, ...parts };
}

describe("listReferencedUuids", () => {
  describe("constraint", () => {
    it("returns [source, target]", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222" },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaa1111", "bbbb2222"]));
    });

    it("skips a null target (keeps the source)", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: null },
      });
      expect(listReferencedUuids(m)).toEqual(["aaaa1111"]);
    });

    it("skips empty / whitespace-only ids", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "", target_wildcard_id: "   " },
      });
      expect(listReferencedUuids(m)).toEqual([]);
    });

    it("combines source/target with `@{}` refs in exceptions", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: {
          source_wildcard_id: "aaaa1111",
          target_wildcard_id: "bbbb2222",
          exceptions: [
            { source: "see @{dddd4444}", target: "literal", mode: "exclude", factor: 0 },
            { source_value: "@{eeee5555}", target_value: "@{ffff6666}", mode: "boost", factor: 2 },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(
        new Set(["aaaa1111", "bbbb2222", "dddd4444", "eeee5555", "ffff6666"]),
      );
    });
  });

  describe("wildcard", () => {
    it("returns the `@{uuid}` ref inside an option value", () => {
      const m = mod({
        id: "11111111",
        type: "wildcard",
        payload: { options: [{ id: "o1", value: "a @{a1b2c3d4} b", weight: 1 }] },
      });
      expect(listReferencedUuids(m)).toEqual(["a1b2c3d4"]);
    });

    it("dedupes across multiple options + multiple refs", () => {
      const m = mod({
        id: "11111111",
        type: "wildcard",
        payload: {
          options: [
            { id: "o1", value: "@{aaaaaaaa} and @{bbbbbbbb}", weight: 1 },
            { id: "o2", value: "@{aaaaaaaa} again", weight: 1 },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaaaaaa", "bbbbbbbb"]));
      expect(listReferencedUuids(m)).toHaveLength(2);
    });
  });

  describe("derivation", () => {
    it("returns `@{}` refs from branch action values and the else action value", () => {
      const m = mod({
        id: "dddd1111",
        type: "derivation",
        payload: {
          rules: [
            {
              id: "r1",
              branches: [
                {
                  condition: { var: "mood", op: "equals", value: "x" },
                  action: { target_var: "out", mode: "replace", value: "branch @{aaaaaaaa}" },
                },
              ],
              else: { action: { target_var: "out", mode: "replace", value: "else @{bbbbbbbb}" } },
            },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaaaaaa", "bbbbbbbb"]));
    });

    it("handles missing/optional rule shapes without throwing", () => {
      const m = mod({
        id: "dddd1111",
        type: "derivation",
        payload: { rules: [{ id: "r1" }, { id: "r2", branches: [] }] },
      });
      expect(listReferencedUuids(m)).toEqual([]);
    });
  });

  describe("self-reference exclusion", () => {
    it("excludes the module's OWN id", () => {
      const m = mod({
        id: "a1b2c3d4",
        type: "wildcard",
        payload: { options: [{ id: "o1", value: "self @{a1b2c3d4} and @{bbbbbbbb}", weight: 1 }] },
      });
      expect(listReferencedUuids(m)).toEqual(["bbbbbbbb"]);
    });

    it("excludes a self-referencing constraint source", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "cccc1111", target_wildcard_id: "bbbb2222" },
      });
      expect(listReferencedUuids(m)).toEqual(["bbbb2222"]);
    });
  });

  describe("types without refs", () => {
    it("fixed_values returns []", () => {
      expect(listReferencedUuids(mod({ id: "ffff1111", type: "fixed_values", payload: { values: [{ name: "x", value: "y" }] } }))).toEqual([]);
    });

    it("combine returns [] (templates treat `@{}` as literal text)", () => {
      expect(
        listReferencedUuids(mod({ id: "cccc9999", type: "combine", payload: { template: "hi @{aaaaaaaa}", output_var: "o", input_vars: [] } })),
      ).toEqual([]);
    });

    it("bundle returns []", () => {
      expect(
        listReferencedUuids(mod({ id: "bbbb1111", type: "bundle", payload: { children: [{ id: "aaaaaaaa", type: "wildcard" }] } })),
      ).toEqual([]);
    });

    it("a wildcard with no refs returns []", () => {
      expect(
        listReferencedUuids(mod({ id: "11111111", type: "wildcard", payload: { options: [{ id: "o1", value: "plain text", weight: 1 }] } })),
      ).toEqual([]);
    });

    it("a constraint with no ids and no exceptions returns []", () => {
      expect(listReferencedUuids(mod({ id: "cccc1111", type: "constraint", payload: {} }))).toEqual([]);
    });
  });
});

/** Minimal catalog-row builder. `resolveDependencies` reads only `id`,
 *  `name`, and `community_post_slug` off each `ModuleRow`, so the fixtures
 *  carry just those (cast to the full row type). */
function row(parts: { id: string; name: string; community_post_slug?: string | null }): ModuleRow {
  return parts as unknown as ModuleRow;
}

describe("resolveDependencies", () => {
  it("maps a ref whose catalog row carries a community_post_slug to a dependency", () => {
    const catalog = [row({ id: "aaaa1111", name: "Hair", community_post_slug: "hair-styles" })];
    expect(resolveDependencies(["aaaa1111"], catalog)).toEqual({
      dependencies: [{ slug: "hair-styles", optional: false }],
      unmet: [],
    });
  });

  it("maps a ref whose catalog row has no slug to an unmet entry (by name)", () => {
    const catalog = [row({ id: "bbbb2222", name: "Local Colors", community_post_slug: null })];
    expect(resolveDependencies(["bbbb2222"], catalog)).toEqual({
      dependencies: [],
      unmet: [{ name: "Local Colors" }],
    });
  });

  it("maps a ref absent from the catalog to an unmet entry keyed by the uuid", () => {
    expect(resolveDependencies(["cccc3333"], [])).toEqual({
      dependencies: [],
      unmet: [{ name: "cccc3333" }],
    });
  });

  it("splits a mix of published, unpublished, and absent refs", () => {
    const catalog = [
      row({ id: "aaaa1111", name: "Hair", community_post_slug: "hair-styles" }),
      row({ id: "bbbb2222", name: "Local Colors", community_post_slug: null }),
    ];
    expect(resolveDependencies(["aaaa1111", "bbbb2222", "cccc3333"], catalog)).toEqual({
      dependencies: [{ slug: "hair-styles", optional: false }],
      unmet: [{ name: "Local Colors" }, { name: "cccc3333" }],
    });
  });

  it("dedupes dependencies by slug and unmet by name", () => {
    const catalog = [
      row({ id: "aaaa1111", name: "Hair", community_post_slug: "hair-styles" }),
      row({ id: "aaaa2222", name: "Hair Alt", community_post_slug: "hair-styles" }),
      row({ id: "bbbb1111", name: "Dup Unmet", community_post_slug: null }),
      row({ id: "bbbb2222", name: "Dup Unmet", community_post_slug: null }),
    ];
    const refs = ["aaaa1111", "aaaa1111", "aaaa2222", "bbbb1111", "bbbb2222", "zzzz9999", "zzzz9999"];
    expect(resolveDependencies(refs, catalog)).toEqual({
      dependencies: [{ slug: "hair-styles", optional: false }],
      unmet: [{ name: "Dup Unmet" }, { name: "zzzz9999" }],
    });
  });

  it("returns empty arrays for no refs", () => {
    expect(resolveDependencies([], [])).toEqual({ dependencies: [], unmet: [] });
  });
});

/** Catalog-row builder carrying the fields `unmetDependencyRows` reads
 *  off the matched row: id + name + community_post_slug (the published
 *  signal). Cast to the full row type. */
function catRow(parts: {
  id: string;
  name: string;
  community_post_slug?: string | null;
}): ModuleRow {
  return parts as unknown as ModuleRow;
}

describe("unmetDependencyRows", () => {
  it("includes a ref that is an UNPUBLISHED library row (in catalog, no slug)", () => {
    const module: ReferencingModule = {
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222" },
    };
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null }),
      catRow({ id: "bbbb2222", name: "Colors" }), // slug absent → unpublished
    ];
    const rows = unmetDependencyRows(module, catalog);
    expect(rows.map((r) => r.id)).toEqual(["aaaa1111", "bbbb2222"]);
  });

  it("excludes a ref that is a PUBLISHED library row (has a slug)", () => {
    const module: ReferencingModule = {
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222" },
    };
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "hair-styles" }),
      catRow({ id: "bbbb2222", name: "Colors", community_post_slug: null }),
    ];
    const rows = unmetDependencyRows(module, catalog);
    // Only the unpublished one survives; the published ref drops off.
    expect(rows.map((r) => r.id)).toEqual(["bbbb2222"]);
  });

  it("excludes a ref that is NOT in the catalog at all (dangling)", () => {
    const module: ReferencingModule = {
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "dangling1", target_wildcard_id: "bbbb2222" },
    };
    const catalog = [catRow({ id: "bbbb2222", name: "Colors", community_post_slug: null })];
    const rows = unmetDependencyRows(module, catalog);
    // `dangling1` isn't in the catalog → can't publish from here → excluded.
    expect(rows.map((r) => r.id)).toEqual(["bbbb2222"]);
  });

  it("treats a blank/whitespace slug as unpublished (included)", () => {
    const module: ReferencingModule = {
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: null },
    };
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "   " })];
    expect(unmetDependencyRows(module, catalog).map((r) => r.id)).toEqual(["aaaa1111"]);
  });

  it("returns [] for a bundle (no refs to gate)", () => {
    const module: ReferencingModule = {
      id: "bbbb1111",
      type: "bundle",
      payload: { children: [{ id: "aaaa1111", type: "wildcard" }] },
    };
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    expect(unmetDependencyRows(module, catalog)).toEqual([]);
  });

  it("dedupes the returned rows by id (first occurrence wins)", () => {
    const module: ReferencingModule = {
      id: "11111111",
      type: "wildcard",
      payload: {
        options: [
          { id: "o1", value: "@{aaaa1111} and @{aaaa1111}", weight: 1 },
        ],
      },
    };
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    expect(unmetDependencyRows(module, catalog)).toHaveLength(1);
  });

  it("returns [] when the module references nothing", () => {
    const module: ReferencingModule = { id: "11111111", type: "wildcard", payload: { options: [] } };
    expect(unmetDependencyRows(module, [])).toEqual([]);
  });
});

describe("bundleChildBundleRefs", () => {
  it("returns the ids of `type:\"bundle\"` children only", () => {
    const children = [
      { id: "wc001abc", type: "wildcard" },
      { id: "bd001abc", type: "bundle", name: "Inner", color: "#fff" },
      { id: "fv001abc", type: "fixed_values" },
      { id: "bd002abc", type: "bundle", name: "Inner 2" },
    ];
    expect(bundleChildBundleRefs(children)).toEqual(["bd001abc", "bd002abc"]);
  });

  it("dedupes (first occurrence wins)", () => {
    const children = [
      { id: "bd001abc", type: "bundle" },
      { id: "bd001abc", type: "bundle" },
      { id: "bd002abc", type: "bundle" },
    ];
    expect(bundleChildBundleRefs(children)).toEqual(["bd001abc", "bd002abc"]);
  });

  it("skips blank / whitespace / non-string ids", () => {
    const children = [
      { id: "", type: "bundle" },
      { id: "   ", type: "bundle" },
      { id: 42, type: "bundle" },
      { id: "bd001abc", type: "bundle" },
    ];
    expect(bundleChildBundleRefs(children)).toEqual(["bd001abc"]);
  });

  it("returns [] when there are no inner-bundle children", () => {
    expect(bundleChildBundleRefs([{ id: "wc001abc", type: "wildcard" }])).toEqual([]);
    expect(bundleChildBundleRefs([])).toEqual([]);
  });
});

/** Bundle-catalog row builder — `bundleUnmetDependencyRows` reads the same
 *  id/name/slug fields off a BundleRow as `unmetDependencyRows` reads off a
 *  ModuleRow. Cast to the full row type. */
function bundleRow(parts: {
  id: string;
  name: string;
  community_post_slug?: string | null;
}): BundleRow {
  return parts as unknown as BundleRow;
}

describe("bundleUnmetDependencyRows", () => {
  it("includes an inner-bundle ref that is UNPUBLISHED (in catalog, no slug)", () => {
    const children = [
      { id: "wc001abc", type: "wildcard" },
      { id: "bd001abc", type: "bundle", name: "Inner" },
    ];
    const bundleCatalog = [
      bundleRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: null }),
    ];
    const rows = bundleUnmetDependencyRows(children, bundleCatalog);
    expect(rows.map((r) => r.id)).toEqual(["bd001abc"]);
  });

  it("excludes an inner-bundle ref that is PUBLISHED (has a slug)", () => {
    const children = [{ id: "bd001abc", type: "bundle", name: "Inner" }];
    const bundleCatalog = [
      bundleRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: "inner-bundle" }),
    ];
    expect(bundleUnmetDependencyRows(children, bundleCatalog)).toEqual([]);
  });

  it("excludes an inner-bundle ref that is NOT in the catalog (dangling)", () => {
    const children = [{ id: "gone9999", type: "bundle", name: "Gone" }];
    const bundleCatalog = [
      bundleRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: null }),
    ];
    expect(bundleUnmetDependencyRows(children, bundleCatalog)).toEqual([]);
  });

  it("ignores non-bundle children (only inner bundles gate)", () => {
    const children = [{ id: "wc001abc", type: "wildcard" }];
    const bundleCatalog = [
      bundleRow({ id: "wc001abc", name: "Wildcard", community_post_slug: null }),
    ];
    expect(bundleUnmetDependencyRows(children, bundleCatalog)).toEqual([]);
  });
});
