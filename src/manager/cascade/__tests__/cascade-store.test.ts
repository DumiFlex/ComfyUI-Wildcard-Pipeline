import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCascadeStore } from "../cascade-store";
import type { LibraryFixture } from "../reverse-dep-index";

const lib: LibraryFixture = {
  wildcards: [
    { id: "11111111", name: "p", payload: { options: [{ id: "o", value: "@{22222222:warm}", weight: 1 }] } },
    { id: "22222222", name: "t", payload: { options: [] } },
  ],
  fixed_values: [],
  combines: [],
  derivations: [],
  constraints: [],
  bundles: [],
  categories: [],
};

describe("cascade-store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("returns empty refs before rebuild", () => {
    const s = useCascadeStore();
    expect(s.subcatRefsTo("22222222", "warm")).toEqual([]);
    expect(s.refsTo("wildcard", "22222222")).toEqual([]);
  });

  it("isStale defaults to true before first rebuild", () => {
    const s = useCascadeStore();
    expect(s.isStale).toBe(true);
  });

  it("rebuild populates index and clears stale flag", () => {
    const s = useCascadeStore();
    s.rebuild(lib);
    expect(s.isStale).toBe(false);
    expect(s.subcatRefsTo("22222222", "warm").length).toBe(1);
  });

  it("invalidate sets stale flag back to true", () => {
    const s = useCascadeStore();
    s.rebuild(lib);
    expect(s.isStale).toBe(false);
    s.invalidate();
    expect(s.isStale).toBe(true);
  });

  it("applyDiff patches index incrementally without full rebuild", () => {
    const s = useCascadeStore();
    s.rebuild(lib);
    expect(s.subcatRefsTo("22222222", "warm").length).toBe(1);
    s.applyDiff([
      { entity_id: "11111111", remove_ref: { kind: "subcat", wildcard_id: "22222222", name: "warm" } },
    ]);
    expect(s.subcatRefsTo("22222222", "warm").length).toBe(0);
  });

  it("applyDiff is no-op before rebuild (index null)", () => {
    const s = useCascadeStore();
    expect(() => s.applyDiff([{ entity_id: "x", removed: true }])).not.toThrow();
  });

  it("combineVarRefsTo + categoryRefsTo return [] before rebuild", () => {
    const s = useCascadeStore();
    expect(s.combineVarRefsTo("mood")).toEqual([]);
    expect(s.categoryRefsTo("cat1")).toEqual([]);
  });
});
