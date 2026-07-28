import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../api/client", () => ({
  api: {
    categories: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    modules: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
  },
  // Re-export ApiError so the SFC's `import { ApiError } from "../api/client"`
  // resolves under the mock.
  ApiError: class ApiError extends Error {},
}));

import { api } from "../api/client";
import Categories from "../views/Categories.vue";

const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiCat).forEach((fn) => fn.mockReset());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("Categories.vue", () => {
  it("renders the page header and 'New category' card", async () => {
    apiCat.list.mockResolvedValue({ items: [] });
    const wrap = mount(Categories, {
      global: { plugins: [] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Categories");
    expect(wrap.text()).toContain("New category");
    // Empty-state row.
    expect(wrap.text()).toContain("No categories yet");
  });

  it("renders existing rows from the mocked store", async () => {
    apiCat.list.mockResolvedValue({
      items: [
        { id: "cat_a", name: "Style", color: "#a78bfa", icon: null, sort_order: 0 },
        { id: "cat_b", name: "Lighting", color: "#22d3ee", icon: null, sort_order: 1 },
      ],
    });
    const wrap = mount(Categories, {
      global: { plugins: [] },
    });
    await flushPromises();
    expect(wrap.find('[data-test="cat-row-cat_a"]').exists()).toBe(true);
    expect(wrap.find('[data-test="cat-row-cat_b"]').exists()).toBe(true);
    expect(wrap.text()).toContain("Style");
    expect(wrap.text()).toContain("Lighting");
  });

  it("derives module counts from the moduleStore", async () => {
    apiCat.list.mockResolvedValue({
      items: [
        { id: "cat_a", name: "Style", color: "#a78bfa", icon: null, sort_order: 0 },
      ],
    });
    apiMod.list.mockResolvedValue({
      items: [
        { id: "wc_1", type: "wildcard", category_id: "cat_a", name: "x", tags: [] },
        { id: "wc_2", type: "wildcard", category_id: "cat_a", name: "y", tags: [] },
        { id: "wc_3", type: "wildcard", category_id: null, name: "z", tags: [] },
      ],
      total: 3,
    });
    const wrap = mount(Categories, {
      global: { plugins: [] },
    });
    await flushPromises();
    expect(wrap.get('[data-test="cat-count-cat_a"]').text()).toBe("2");
  });

  it("Add button calls api.categories.create with name + color", async () => {
    apiCat.list.mockResolvedValue({ items: [] });
    apiCat.create.mockResolvedValue({
      id: "cat_new", name: "Mood", color: "#fbbf24", icon: null, sort_order: 0,
    });
    const wrap = mount(Categories, {
      global: { plugins: [] },
    });
    await flushPromises();
    await wrap.get('[data-test="new-cat-name"]').setValue("Mood");
    await wrap.get('[data-test="add-category-btn"]').trigger("click");
    await flushPromises();
    expect(apiCat.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Mood", color: expect.stringMatching(/^#/) }),
    );
  });

  it("renders a category's icon glyph in its row", async () => {
    // The `icon` column has existed end-to-end (engine column, wp_api
    // _UPDATABLE_FIELDS, CategoryRow.icon) with no UI to set or show it.
    apiCat.list.mockResolvedValue({
      items: [{ id: "cat_a", name: "Style", color: "#a78bfa", icon: "palette", sort_order: 0 }],
    });
    const wrap = mount(Categories, { global: { plugins: [] } });
    await flushPromises();
    expect(wrap.get('[data-test="cat-icon-cat_a"]').classes()).toContain("pi-palette");
  });

  it("picking an icon while editing saves it with the row", async () => {
    apiCat.list.mockResolvedValue({
      items: [{ id: "cat_a", name: "Style", color: "#a78bfa", icon: null, sort_order: 0 }],
    });
    apiCat.update.mockResolvedValue({
      id: "cat_a", name: "Style", color: "#a78bfa", icon: "palette", sort_order: 0,
    });
    const wrap = mount(Categories, { global: { plugins: [], stubs: { Teleport: true } } });
    await flushPromises();
    await wrap.get('[data-test="cat-edit-cat_a"]').trigger("click");
    await wrap.get('[data-test="cat-icon-picker-cat_a"]').trigger("click");
    await flushPromises();
    await wrap.get('[data-test="icon-picker-palette"]').trigger("click");
    await wrap.get('[data-test="cat-save-cat_a"]').trigger("click");
    await flushPromises();
    expect(apiCat.update).toHaveBeenCalledWith(
      "cat_a",
      expect.objectContaining({ icon: "palette" }),
    );
  });

  it("new-category create carries the picked icon", async () => {
    apiCat.list.mockResolvedValue({ items: [] });
    apiCat.create.mockResolvedValue({
      id: "cat_new", name: "Mood", color: "#fbbf24", icon: "moon", sort_order: 0,
    });
    const wrap = mount(Categories, { global: { plugins: [], stubs: { Teleport: true } } });
    await flushPromises();
    await wrap.get('[data-test="new-cat-name"]').setValue("Mood");
    await wrap.get('[data-test="new-cat-icon"]').trigger("click");
    await flushPromises();
    await wrap.get('[data-test="icon-picker-moon"]').trigger("click");
    await wrap.get('[data-test="add-category-btn"]').trigger("click");
    await flushPromises();
    expect(apiCat.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Mood", icon: "moon" }),
    );
  });
});
