import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useCleanerPresetStore } from "../stores/cleanerPresetStore";

describe("cleanerPresetStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/wp/api/cleaner-presets") && !url.includes("/hashes")) {
        return Promise.resolve(new Response(JSON.stringify({
          items: [
            {
              id: "builtin-gentle",
              name: "gentle",
              description: "Built-in gentle",
              category_id: null,
              tags: [],
              is_favorite: false,
              is_builtin: true,
              payload: {
                intensity: "gentle",
                mode: "tags",
                rules_override: {},
                blocklist: { kind: "list", entries: [] },
              },
              payload_hash: "abc",
              version: 1,
              created_at: "2026-05-25T00:00:00Z",
              updated_at: "2026-05-25T00:00:00Z",
            },
          ],
        })));
      }
      return Promise.resolve(new Response("{}"));
    }));
  });

  it("fetchAll populates items + flips loading flag", async () => {
    const store = useCleanerPresetStore();
    expect(store.items).toEqual([]);
    expect(store.loading).toBe(false);
    const p = store.fetchAll();
    expect(store.loading).toBe(true);
    await p;
    expect(store.loading).toBe(false);
    expect(store.items).toHaveLength(1);
    expect(store.items[0].name).toBe("gentle");
  });

  it("findById returns cached row", async () => {
    const store = useCleanerPresetStore();
    await store.fetchAll();
    expect(store.findById("builtin-gentle")?.name).toBe("gentle");
    expect(store.findById("nope")).toBeUndefined();
  });

  it("builtins + userPresets getters partition items", async () => {
    const store = useCleanerPresetStore();
    await store.fetchAll();
    expect(store.builtins).toHaveLength(1);
    expect(store.userPresets).toHaveLength(0);
  });
});
