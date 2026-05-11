import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    bundles: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      favorite: vi.fn(),
    },
  },
}));

import { api } from "../api/client";
import { useBundleStore } from "../stores/bundleStore";

const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiBundles).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.clearAllMocks());

describe("bundleStore", () => {
  it("fetchAll populates items", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{ id: "abcd1234", name: "subject_phrase", color: "#FB7185" }],
      total: 1,
    });
    const s = useBundleStore();
    await s.fetchAll();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].id).toBe("abcd1234");
  });

  it("fetchAll forwards filters", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const s = useBundleStore();
    s.filter.q = "subject";
    s.filter.favorites = true;
    await s.fetchAll();
    expect(apiBundles.list).toHaveBeenCalledWith({ q: "subject", favorites: true });
  });

  it("create unshifts to items", async () => {
    apiBundles.create.mockResolvedValue({
      id: "newbundle", name: "new", color: null,
    });
    const s = useBundleStore();
    await s.create({ name: "new" });
    expect(s.items[0].id).toBe("newbundle");
  });

  it("update replaces item in place", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{ id: "abcd1234", name: "old", color: null }],
      total: 1,
    });
    const s = useBundleStore();
    await s.fetchAll();

    apiBundles.update.mockResolvedValue({ id: "abcd1234", name: "renamed", color: "#FB7185" });
    await s.update("abcd1234", { name: "renamed", color: "#FB7185" });
    expect(s.items[0].name).toBe("renamed");
    expect(s.items[0].color).toBe("#FB7185");
  });

  it("remove drops the row", async () => {
    apiBundles.list.mockResolvedValue({
      items: [
        { id: "a", name: "alpha" },
        { id: "b", name: "beta" },
      ],
      total: 2,
    });
    const s = useBundleStore();
    await s.fetchAll();
    apiBundles.delete.mockResolvedValue(undefined);
    await s.remove("a");
    expect(s.items).toHaveLength(1);
    expect(s.items[0].id).toBe("b");
  });

  it("toggleFavorite replaces row in place", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{ id: "abcd1234", name: "x", is_favorite: false }],
      total: 1,
    });
    const s = useBundleStore();
    await s.fetchAll();
    apiBundles.favorite.mockResolvedValue({ id: "abcd1234", name: "x", is_favorite: true });
    await s.toggleFavorite("abcd1234");
    expect(s.items[0].is_favorite).toBe(true);
  });

  it("loading flag toggles around fetchAll", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const s = useBundleStore();
    expect(s.loading).toBe(false);
    const promise = s.fetchAll();
    expect(s.loading).toBe(true);
    await promise;
    expect(s.loading).toBe(false);
  });
});
