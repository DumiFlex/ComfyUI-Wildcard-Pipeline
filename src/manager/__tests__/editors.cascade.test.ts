import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCascadeStore } from "../cascade/cascade-store";

describe("editors cascade-store integration", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("refsTo returns combine module references via $var refs", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [{
        id: "11111111", name: "w",
        payload: { options: [{ id: "o", value: "uses $mood here", weight: 1 }] },
      }],
      combines: [{
        id: "ccccc111", name: "c",
        payload: { template: "x", output_var: "mood" },
      }],
      fixed_values: [], derivations: [],
      constraints: [], bundles: [], categories: [],
    });
    // Combine's output_var "mood" should surface in toCombineVar refs.
    expect(store.combineVarRefsTo("mood")).toHaveLength(1);
  });

  it("refsTo returns bundle references for an entity in children[]", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [{ id: "11111111", name: "w", payload: { options: [] } }],
      combines: [], fixed_values: [], derivations: [], constraints: [],
      bundles: [{
        id: "bbbbbb11", name: "b1",
        children: [{ id: "11111111", type: "module" }],
      }],
      categories: [],
    });
    const refs = store.refsTo("wildcard", "11111111");
    expect(refs.some((r) => r.from_kind === "bundle" && r.from_id === "bbbbbb11")).toBe(true);
  });

  it("categoryRefsTo returns modules referencing a category", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        { id: "11111111", name: "w1", payload: { options: [] }, category_id: "cat1" },
        { id: "22222222", name: "w2", payload: { options: [] } },
      ],
      combines: [], fixed_values: [], derivations: [], constraints: [],
      bundles: [], categories: [{ id: "cat1", name: "Style" }],
    });
    expect(store.categoryRefsTo("cat1")).toHaveLength(1);
    expect(store.categoryRefsTo("cat2")).toHaveLength(0);
  });

  it("constraint references both source and target wildcards", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        { id: "11111111", name: "src", payload: { options: [] } },
        { id: "22222222", name: "tgt", payload: { options: [] } },
      ],
      combines: [], fixed_values: [], derivations: [],
      constraints: [{
        id: "cccccc11", name: "c",
        payload: {
          source_wildcard_id: "11111111", target_wildcard_id: "22222222",
          matrix: {}, exceptions: [],
        },
      }],
      bundles: [], categories: [],
    });
    expect(store.refsTo("wildcard", "11111111").some(r => r.from_kind === "constraint")).toBe(true);
    expect(store.refsTo("wildcard", "22222222").some(r => r.from_kind === "constraint")).toBe(true);
  });
});
