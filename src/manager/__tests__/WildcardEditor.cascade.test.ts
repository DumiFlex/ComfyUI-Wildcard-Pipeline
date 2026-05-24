import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCascadeStore } from "../cascade/cascade-store";

describe("WildcardEditor cascade store integration", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("subcatRefsTo returns correct count for a constraint-referenced subcat", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        {
          id: "11111111",
          name: "palette",
          payload: {
            options: [{ id: "o", value: "v", weight: 1, sub_categories: ["warm"] }],
          },
        },
        { id: "22222222", name: "other", payload: { options: [] } },
      ],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [
        {
          id: "cccccc11",
          name: "c",
          payload: {
            source_wildcard_id: "11111111",
            target_wildcard_id: "22222222",
            matrix: { warm: { a: { mode: "block" } } },
            exceptions: [],
          },
        },
      ],
      bundles: [],
      categories: [],
    });
    expect(store.subcatRefsTo("11111111", "warm")).toHaveLength(1);
    expect(store.subcatRefsTo("11111111", "cool")).toHaveLength(0);
  });

  it("subcatRefsTo returns empty array when index is not yet built", () => {
    const store = useCascadeStore();
    // No rebuild() called — store starts stale with null index.
    expect(store.subcatRefsTo("11111111", "warm")).toHaveLength(0);
    expect(store.isStale).toBe(true);
  });

  it("subcatRefsTo picks up refs from option-value subcat filter syntax", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        {
          id: "aaaaaaaa",
          name: "src",
          payload: {
            // Option value references target wildcard with :cool subcat filter
            options: [{ id: "o1", value: "@{bbbbbbbb:cool} some text", weight: 1 }],
          },
        },
        {
          id: "bbbbbbbb",
          name: "target",
          payload: {
            options: [],
            sub_categories: ["cool", "warm"],
          },
        },
      ],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [],
      bundles: [],
      categories: [],
    });
    // "cool" subcat on bbbbbbbb is referenced by aaaaaaaa's option value
    expect(store.subcatRefsTo("bbbbbbbb", "cool")).toHaveLength(1);
    expect(store.subcatRefsTo("bbbbbbbb", "warm")).toHaveLength(0);
    // aaaaaaaa has no subcat refs pointing at it
    expect(store.subcatRefsTo("aaaaaaaa", "cool")).toHaveLength(0);
  });

  it("subcatRefsTo counts correctly after applyDiff removes a ref", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        {
          id: "11111111",
          name: "palette",
          payload: { options: [] },
        },
      ],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [
        {
          id: "cccccc11",
          name: "c",
          payload: {
            source_wildcard_id: "11111111",
            target_wildcard_id: "22222222",
            matrix: { warm: { a: { mode: "block" } } },
            exceptions: [],
          },
        },
      ],
      bundles: [],
      categories: [],
    });

    expect(store.subcatRefsTo("11111111", "warm")).toHaveLength(1);

    // Simulate a cascade-apply that removes the constraint entirely
    store.applyDiff([{ entity_id: "cccccc11", removed: true }]);

    expect(store.subcatRefsTo("11111111", "warm")).toHaveLength(0);
  });

  it("optionRefsTo returns refs from constraint exceptions", () => {
    const store = useCascadeStore();
    store.rebuild({
      wildcards: [
        {
          id: "11111111", name: "hair",
          payload: { sub_categories: [], options: [
            { id: "opt_aaaa", value: "buzz", sub_category: null },
          ] },
        },
      ],
      fixed_values: [], combines: [], derivations: [],
      constraints: [
        {
          id: "cccccc11", name: "c",
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
        },
      ],
      bundles: [], categories: [],
    });
    expect(store.optionRefsTo("opt_aaaa")).toHaveLength(1);
    expect(store.optionRefsTo("opt_missing")).toHaveLength(0);
  });
});
