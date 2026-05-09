// Library autocomplete suggestion walkers — single source for the three
// SPA editors that today duplicate the catalog walking logic
// (CombineEditor, DerivationEditor, WildcardEditor). Tests assert the
// per-kind extraction rules + dedup + sort + exclude-id behavior.

import { describe, it, expect } from "vitest";

import {
  collectLibraryVarHints,
  collectLibraryWildcardRefs,
  type ModuleStoreLike,
} from "./library-suggestions";
import type { ModuleRow } from "../api/types";

function row(over: Partial<ModuleRow>): ModuleRow {
  return {
    id: "00000000",
    type: "wildcard",
    name: "name",
    description: "",
    category_id: null,
    tags: [],
    payload: {},
    payload_hash: null,
    created_at: "",
    updated_at: "",
    ...over,
  } as ModuleRow;
}

function store(items: ModuleRow[]): ModuleStoreLike {
  return { items };
}

describe("collectLibraryVarHints", () => {
  it("extracts wildcard var_binding from payload", () => {
    const hints = collectLibraryVarHints(
      store([
        row({
          id: "wc111111",
          type: "wildcard",
          name: "Color",
          payload: { var_binding: "color" },
        }),
      ]),
    );
    expect(hints).toEqual([{ label: "color", kind: "wildcard" }]);
  });

  it("falls back to slug-of-name when wildcard has no var_binding", () => {
    const hints = collectLibraryVarHints(
      store([
        row({
          id: "wc111111",
          type: "wildcard",
          name: "Hair Color",
          payload: {}, // no var_binding
        }),
      ]),
    );
    // toIdentifier slugs to lower-snake-case
    expect(hints[0].label).toBe("hair_color");
    expect(hints[0].kind).toBe("wildcard");
  });

  it("extracts each fixed_values row name", () => {
    const hints = collectLibraryVarHints(
      store([
        row({
          id: "fv111111",
          type: "fixed_values",
          name: "Presets",
          payload: {
            values: [
              { id: "v1", name: "lens", value: "85mm" },
              { id: "v2", name: "$angle", value: "wide" },
            ],
          },
        }),
      ]),
    );
    // Leading $ stripped per existing convention; results sort alphabetically
    expect(hints).toEqual([
      { label: "angle", kind: "fixed_values" },
      { label: "lens", kind: "fixed_values" },
    ]);
  });

  it("extracts combine output_var", () => {
    const hints = collectLibraryVarHints(
      store([
        row({
          id: "cb111111",
          type: "combine",
          name: "Final",
          payload: { output_var: "final_prompt", template: "x" },
        }),
      ]),
    );
    expect(hints).toEqual([{ label: "final_prompt", kind: "combine" }]);
  });

  it("excludes the module whose id matches excludeId", () => {
    const hints = collectLibraryVarHints(
      store([
        row({ id: "wc111111", type: "wildcard", name: "A", payload: { var_binding: "a" } }),
        row({ id: "wc222222", type: "wildcard", name: "B", payload: { var_binding: "b" } }),
      ]),
      "wc111111",
    );
    expect(hints).toEqual([{ label: "b", kind: "wildcard" }]);
  });

  it("dedups labels across kinds + sorts alphabetically", () => {
    const hints = collectLibraryVarHints(
      store([
        row({ id: "wc111111", type: "wildcard", name: "Z", payload: { var_binding: "zebra" } }),
        row({ id: "wc222222", type: "wildcard", name: "A", payload: { var_binding: "apple" } }),
        // Duplicate label from a different kind — first occurrence wins.
        row({ id: "fv111111", type: "fixed_values", name: "FV", payload: { values: [{ id: "v1", name: "apple", value: "" }] } }),
      ]),
    );
    expect(hints.map((h) => h.label)).toEqual(["apple", "zebra"]);
  });

  it("returns empty when store has no modules", () => {
    expect(collectLibraryVarHints(store([]))).toEqual([]);
  });
});

describe("collectLibraryWildcardRefs", () => {
  it("returns wildcard UUIDs only — skips other kinds", () => {
    const items = [
      row({ id: "wc111111", type: "wildcard", name: "A" }),
      row({ id: "fv111111", type: "fixed_values", name: "B" }),
      row({ id: "cb111111", type: "combine", name: "C" }),
    ];
    const refs = collectLibraryWildcardRefs(store(items));
    expect(refs).toEqual(["wc111111"]);
  });

  it("excludes the module whose id matches excludeId", () => {
    const items = [
      row({ id: "wc111111", type: "wildcard", name: "A" }),
      row({ id: "wc222222", type: "wildcard", name: "B" }),
    ];
    const refs = collectLibraryWildcardRefs(store(items), "wc111111");
    expect(refs).toEqual(["wc222222"]);
  });

  it("sorts UUIDs by display name (uuidToName) when provided", () => {
    const items = [
      row({ id: "wc111111", type: "wildcard", name: "Zebra" }),
      row({ id: "wc222222", type: "wildcard", name: "Apple" }),
    ];
    const uuidToName = new Map([
      ["wc111111", "Zebra"],
      ["wc222222", "Apple"],
    ]);
    const refs = collectLibraryWildcardRefs(store(items), undefined, uuidToName);
    // Apple (wc222222) before Zebra (wc111111)
    expect(refs).toEqual(["wc222222", "wc111111"]);
  });

  it("falls back to UUID order when no uuidToName provided", () => {
    const items = [
      row({ id: "wc999999", type: "wildcard", name: "C" }),
      row({ id: "wc111111", type: "wildcard", name: "A" }),
    ];
    const refs = collectLibraryWildcardRefs(store(items));
    expect(refs).toEqual(["wc111111", "wc999999"]);
  });
});
