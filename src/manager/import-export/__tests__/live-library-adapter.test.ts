import { describe, expect, it } from "vitest";
import { liveLibraryToRawPayload } from "../live-library-adapter";
import { buildDepGraph } from "../dep-graph";
import type { BundleRow, CategoryRow, ModuleRow, ModuleType } from "../../api/types";

function mkModule(
  over: Partial<ModuleRow> & Pick<ModuleRow, "id" | "type" | "name">,
): ModuleRow {
  return {
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
  } as ModuleRow;
}

function mkBundle(
  over: Partial<BundleRow> & Pick<BundleRow, "id" | "name">,
): BundleRow {
  return {
    description: "",
    color: null,
    category_id: null,
    tags: [],
    is_favorite: false,
    children: [],
    payload_hash: "",
    version: 1,
    created_at: "",
    updated_at: "",
    ...over,
  } as BundleRow;
}

function mkCategory(
  over: Partial<CategoryRow> & Pick<CategoryRow, "id" | "name">,
): CategoryRow {
  return { color: null, icon: null, sort_order: 0, ...over } as CategoryRow;
}

describe("liveLibraryToRawPayload", () => {
  it("returns empty 8-bucket payload with schema_version=1 when library is empty", () => {
    const out = liveLibraryToRawPayload([], [], []);
    expect(out).toEqual({
      schema_version: 1,
      bundles: [],
      wildcards: [],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [],
      categories: [],
      templates: [],
    });
  });

  it("routes the 5 module types into the 5 correct buckets", () => {
    const modules: ModuleRow[] = [
      mkModule({ id: "w1",  type: "wildcard",     name: "$color" }),
      mkModule({ id: "fv1", type: "fixed_values", name: "fv1" }),
      mkModule({ id: "co1", type: "combine",      name: "co1" }),
      mkModule({ id: "dr1", type: "derivation",   name: "dr1" }),
      mkModule({ id: "cn1", type: "constraint",   name: "cn1" }),
    ];
    const out = liveLibraryToRawPayload(modules, [], []);
    expect(out.wildcards.map((x) => (x as { id: string }).id)).toEqual(["w1"]);
    expect(out.fixed_values.map((x) => (x as { id: string }).id)).toEqual(["fv1"]);
    expect(out.combines.map((x) => (x as { id: string }).id)).toEqual(["co1"]);
    expect(out.derivations.map((x) => (x as { id: string }).id)).toEqual(["dr1"]);
    expect(out.constraints.map((x) => (x as { id: string }).id)).toEqual(["cn1"]);
  });

  it("flattens wildcard payload.options up to top level", () => {
    const w = mkModule({
      id: "aabbccdd",
      type: "wildcard",
      name: "$x",
      payload: { options: [{ id: "o1", value: "see @{deadbeef}", weight: 1 }] },
    });
    const out = liveLibraryToRawPayload([w], [], []);
    expect(out.wildcards).toHaveLength(1);
    const flat = out.wildcards[0] as {
      id: string;
      options?: Array<{ value: string }>;
    };
    expect(flat.id).toBe("aabbccdd");
    expect(Array.isArray(flat.options)).toBe(true);
    expect(flat.options).toEqual([
      { id: "o1", value: "see @{deadbeef}", weight: 1 },
    ]);
  });

  it("preserves bundle children at top level", () => {
    const b = mkBundle({
      id: "bbbb1111",
      name: "outer",
      children: [{ id: "bbbb2222", type: "bundle", name: "inner" }],
    });
    const out = liveLibraryToRawPayload([], [b], []);
    expect(out.bundles).toHaveLength(1);
    const passed = out.bundles[0] as {
      id: string;
      children?: Array<{ id: string; type: string; name?: string }>;
    };
    expect(passed.id).toBe("bbbb1111");
    expect(passed.children).toEqual([
      { id: "bbbb2222", type: "bundle", name: "inner" },
    ]);
  });

  it("preserves constraint payload nested (source_wildcard_id / target_wildcard_id)", () => {
    const c = mkModule({
      id: "cccc1111",
      type: "constraint" as ModuleType,
      name: "c1",
      payload: {
        source_wildcard_id: "eeee1111",
        target_wildcard_id: "eeee2222",
        matrix: {},
        exceptions: [],
      },
    });
    const out = liveLibraryToRawPayload([c], [], []);
    expect(out.constraints).toHaveLength(1);
    const passed = out.constraints[0] as {
      id: string;
      payload?: { source_wildcard_id?: string; target_wildcard_id?: string };
    };
    expect(passed.id).toBe("cccc1111");
    expect(passed.payload?.source_wildcard_id).toBe("eeee1111");
    expect(passed.payload?.target_wildcard_id).toBe("eeee2222");
  });

  it("passes categories through with id + name", () => {
    const cat = mkCategory({ id: "cat11111", name: "palette" });
    const out = liveLibraryToRawPayload([], [], [cat]);
    expect(out.categories).toHaveLength(1);
    const passed = out.categories[0] as { id: string; name: string };
    expect(passed.id).toBe("cat11111");
    expect(passed.name).toBe("palette");
  });

  it("integrates with buildDepGraph — flattened wildcard options yield outgoing edges", () => {
    // Wildcard A's payload.options[0].value references @{bbbbbbbb}; after
    // the adapter flattens payload.options to the top level, buildDepGraph
    // walks the nested @{id} refs and emits an outgoing edge from A → B.
    const wA = mkModule({
      id: "aaaaaaaa",
      type: "wildcard",
      name: "$a",
      payload: {
        options: [{ id: "o1", value: "uses @{bbbbbbbb}", weight: 1 }],
      },
    });
    const wB = mkModule({
      id: "bbbbbbbb",
      type: "wildcard",
      name: "$b",
      payload: { options: [] },
    });
    const out = liveLibraryToRawPayload([wA, wB], [], []);
    const graph = buildDepGraph(out);
    expect(graph["aaaaaaaa"]).toEqual(["bbbbbbbb"]);
    expect(graph["bbbbbbbb"]).toEqual([]);
  });

  it("silently drops modules with an unknown type", () => {
    const garbage = mkModule({
      id: "ffff1111",
      // Force a non-ModuleType value through the typed Pick<>.
      type: "garbage" as unknown as ModuleType,
      name: "?",
    });
    const out = liveLibraryToRawPayload([garbage], [], []);
    expect(out.wildcards).toEqual([]);
    expect(out.fixed_values).toEqual([]);
    expect(out.combines).toEqual([]);
    expect(out.derivations).toEqual([]);
    expect(out.constraints).toEqual([]);
    expect(out.bundles).toEqual([]);
    expect(out.categories).toEqual([]);
  });
});
