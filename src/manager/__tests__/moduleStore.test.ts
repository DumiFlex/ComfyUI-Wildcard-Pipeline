import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    modules: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      duplicate: vi.fn(),
      favorite: vi.fn(),
    },
  },
}));

import { api } from "../api/client";
import { useModuleStore } from "../stores/moduleStore";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.clearAllMocks());

describe("moduleStore", () => {
  it("switches kind from the one catalog, with no request per kind or search", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "w1", name: "warm", type: "wildcard", is_favorite: false },
        { id: "c1", name: "rule", type: "constraint", is_favorite: false },
      ],
      total: 2,
    });
    const s = useModuleStore();
    s.filter.type = "wildcard";
    await s.fetchAll();
    expect(s.items.map((i) => i.id)).toEqual(["w1"]);
    s.filter.q = "zzz";
    await s.fetchAll();
    expect(s.items).toHaveLength(0);
    s.filter.type = "constraint";
    s.filter.q = undefined;
    await s.fetchAll();
    expect(s.items.map((i) => i.id)).toEqual(["c1"]);
    expect(apiMod.list).toHaveBeenCalledTimes(1);
  });

  it("clears another kind's rows while the first catalog fetch is still out", async () => {
    apiMod.list.mockReturnValue(new Promise(() => {}));
    const s = useModuleStore();
    s.items = [{ id: "w1", name: "w", type: "wildcard" } as never];
    s.filter.type = "constraint";
    void s.fetchAll();
    expect(s.items).toHaveLength(0);
    expect(s.loading).toBe(true);
  });

  it("a page mounting while the boot fetch runs shares that request", async () => {
    let land: (v: unknown) => void = () => {};
    apiMod.list.mockReturnValueOnce(new Promise((r) => { land = r; }));
    const s = useModuleStore();
    const boot = s.ensureCatalog();
    s.filter.type = "wildcard";
    const page = s.fetchAll();
    land({ items: [{ id: "w1", name: "w", type: "wildcard", is_favorite: false }], total: 1 });
    await Promise.all([boot, page]);
    expect(apiMod.list).toHaveBeenCalledTimes(1);
    expect(s.items.map((i) => i.id)).toEqual(["w1"]);
    expect(s.loading).toBe(false);
  });

  it("keeps the newest catalog when an older fetch lands last", async () => {
    let slow: (v: unknown) => void = () => {};
    apiMod.list
      .mockReturnValueOnce(new Promise((r) => { slow = r; }))
      .mockResolvedValueOnce({ items: [{ id: "new", name: "n", type: "wildcard", is_favorite: false }], total: 1 });
    const s = useModuleStore();
    const first = s.fetchCatalog();
    await s.fetchCatalog();
    slow({ items: [{ id: "old", name: "o", type: "wildcard", is_favorite: false }], total: 1 });
    await first;
    expect(s.catalog.map((i) => i.id)).toEqual(["new"]);
  });

  it("fetchAll populates items", async () => {
    apiMod.list.mockResolvedValue({
      items: [{ id: "wc_x_1", name: "x", type: "wildcard", is_favorite: false }],
      total: 1,
    });
    const s = useModuleStore();
    await s.fetchAll();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].id).toBe("wc_x_1");
  });

  it("fetchAll applies the server's filter on the client", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "aa11bb22", name: "Hair color", type: "wildcard", is_favorite: true, category_id: "c1" },
        { id: "cc33dd44", name: "Eye color", type: "wildcard", is_favorite: false, category_id: "c1" },
        { id: "ee55ff66", name: "Color rule", type: "constraint", is_favorite: true, category_id: "c1" },
        { id: "0a0b0c0d", name: "Mood", type: "wildcard", is_favorite: true, category_id: null },
      ],
      total: 4,
    });
    const s = useModuleStore();
    s.filter.type = "wildcard";
    s.filter.q = "COLOR";
    await s.fetchAll();
    expect(apiMod.list).toHaveBeenCalledWith({});
    expect(s.items.map((i) => i.id)).toEqual(["aa11bb22", "cc33dd44"]);
    s.filter.favorites = true;
    await s.fetchAll();
    expect(s.items.map((i) => i.id)).toEqual(["aa11bb22"]);
    // The id matches too (the server's `name OR id LIKE`).
    s.filter.q = "0B0C";
    s.filter.favorites = false;
    await s.fetchAll();
    expect(s.items.map((i) => i.id)).toEqual(["0a0b0c0d"]);
    s.filter.q = undefined;
    s.filter.category = "c1";
    await s.fetchAll();
    expect(s.items.map((i) => i.id)).toEqual(["aa11bb22", "cc33dd44"]);
  });

  // Regression: editors and the sidebar need cross-kind cross-references (e.g.
  // ConstraintEditor needs all wildcards even when the user came from the
  // Constraints list page that pinned `filter.type = "constraint"`). The
  // catalog must reflect ALL modules without the persistent filter; `items`
  // is left to whatever the active list view loaded (the original implementation
  // wrote items too, but that raced with per-view fetchAll and stomped the
  // typed subset, causing combines to appear in the Wildcards list).
  it("fetchCatalog ignores persisted filters and writes catalog only", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "wc_a", type: "wildcard" },
        { id: "co_b", type: "combine" },
      ],
      total: 2,
    });
    const s = useModuleStore();
    s.filter.type = "constraint";
    s.filter.q = "anything";
    s.filter.favorites = true;
    const beforeItems = s.items.length;
    await s.fetchCatalog();
    expect(apiMod.list).toHaveBeenCalledWith({});
    expect(s.catalog).toHaveLength(2);
    expect(s.items.length).toBe(beforeItems);
  });

  it("create unshifts to items", async () => {
    apiMod.create.mockResolvedValue({ id: "wc_y_2", name: "y", type: "wildcard" });
    const s = useModuleStore();
    await s.create({ type: "wildcard", name: "y", payload: {} });
    expect(s.items[0].id).toBe("wc_y_2");
  });

  it("update replaces item in place", async () => {
    apiMod.list.mockResolvedValue({
      items: [{ id: "wc_x_1", name: "x", type: "wildcard" }],
      total: 1,
    });
    apiMod.update.mockResolvedValue({ id: "wc_x_1", name: "renamed", type: "wildcard" });
    const s = useModuleStore();
    await s.fetchAll();
    await s.update("wc_x_1", { name: "renamed" });
    expect(s.items[0].name).toBe("renamed");
  });

  it("remove drops from items + calls api.delete", async () => {
    apiMod.list.mockResolvedValue({
      items: [{ id: "wc_x_1", name: "x", type: "wildcard" }],
      total: 1,
    });
    apiMod.delete.mockResolvedValue(undefined);
    const s = useModuleStore();
    await s.fetchAll();
    await s.remove("wc_x_1");
    expect(apiMod.delete).toHaveBeenCalledWith("wc_x_1");
    expect(s.items).toHaveLength(0);
  });

  it("duplicate unshifts new item", async () => {
    apiMod.duplicate.mockResolvedValue({ id: "wc_a_2", name: "a (copy)", type: "wildcard" });
    const s = useModuleStore();
    await s.duplicate("wc_a_1");
    expect(s.items[0].id).toBe("wc_a_2");
  });

  it("toggleFavorite swaps is_favorite locally on success", async () => {
    apiMod.list.mockResolvedValue({
      items: [{ id: "wc_x_1", is_favorite: false, type: "wildcard" }],
      total: 1,
    });
    apiMod.favorite.mockResolvedValue({ id: "wc_x_1", is_favorite: true, type: "wildcard" });
    const s = useModuleStore();
    await s.fetchAll();
    await s.toggleFavorite("wc_x_1");
    expect(s.items[0].is_favorite).toBe(true);
  });

  it("a created row of another kind stays off a listed kind's page", async () => {
    apiMod.list.mockResolvedValue({ items: [{ id: "w1", name: "w", type: "wildcard" }], total: 1 });
    apiMod.create.mockResolvedValue({ id: "c1", name: "c", type: "constraint" });
    const s = useModuleStore();
    s.filter.type = "wildcard";
    await s.fetchAll();
    const before = s.catalog;
    await s.create({ type: "constraint", name: "c", payload: {} });
    // A new array (never mutated in place): the validation cache keys on it.
    expect(s.catalog).not.toBe(before);
    expect(s.catalog.map((i) => i.id)).toEqual(["c1", "w1"]);
    expect(s.items.map((i) => i.id)).toEqual(["w1"]);
  });

  it("loading flag toggles around fetchAll", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    apiMod.list.mockReturnValue(new Promise((r) => { resolveFn = r; }));
    const s = useModuleStore();
    const promise = s.fetchAll();
    expect(s.loading).toBe(true);
    resolveFn({ items: [], total: 0 });
    await promise;
    expect(s.loading).toBe(false);
  });

  it("wildcards + fixedValues computed split items by type", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "wc_a", type: "wildcard" },
        { id: "fv_b", type: "fixed_values" },
        { id: "wc_c", type: "wildcard" },
      ],
      total: 3,
    });
    const s = useModuleStore();
    await s.fetchAll();
    expect(s.wildcards).toHaveLength(2);
    expect(s.fixedValues).toHaveLength(1);
  });
});
