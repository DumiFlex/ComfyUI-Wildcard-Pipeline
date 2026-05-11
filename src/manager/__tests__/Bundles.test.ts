import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

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
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../api/client";
import Bundles from "../views/Bundles.vue";

const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiBundles).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/bundles/new", component: { template: "<div/>" } },
      { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(Bundles, { global: { plugins: [makeRouter()] } });
}

describe("Bundles.vue", () => {
  it("calls bundles.list on mount", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    mountView();
    await flushPromises();
    expect(apiBundles.list).toHaveBeenCalled();
  });

  it("renders bundle rows with name, id, child count", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{
        id: "bn_abc12345",
        name: "Character Pack",
        description: "",
        color: "#7a5cff",
        category_id: null,
        tags: [],
        is_favorite: false,
        children: [
          { id: "wc_1", type: "wildcard", name: "hair" },
          { id: "wc_2", type: "wildcard", name: "outfit" },
          { id: "co_3", type: "combine", name: "phrase" },
        ],
        payload_hash: "abcdef0123456789",
        version: 1,
        created_at: "",
        updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Character Pack");
    expect(wrap.text()).toContain("bn_abc12345");
    // Child count column shows "3"
    expect(wrap.text()).toContain("3");
  });

  it("empty-state copy mentions creating bundles from Context", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Context");
  });

  it("renders default frame color when row.color is null", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{
        id: "bn_x", name: "Default", description: "", color: null, category_id: null,
        tags: [], is_favorite: false, children: [],
        payload_hash: "", version: 1, created_at: "", updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    const swatch = wrap.find(".wp-bundle-swatch");
    expect(swatch.exists()).toBe(true);
    // jsdom resolves rgb(...) for the inline-style background.
    expect(swatch.attributes("style") ?? "").toMatch(/#46566B|rgb\(70,\s*86,\s*107\)/i);
  });
});
