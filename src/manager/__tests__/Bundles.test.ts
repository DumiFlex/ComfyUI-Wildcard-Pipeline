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
    // moduleStore.fetchCatalog() runs in Bundles.vue onMounted to power
    // the per-row validity check. Stub it so the test mount doesn't
    // explode on `api.modules.list is undefined`.
    modules: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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

  it("caps the expanded child list and summarises kinds", async () => {
    // A 66-child scene-composer bundle used to dump every row inline on
    // expand and bury the rest of the list.
    const children = Array.from({ length: 20 }, (_, i) => ({
      id: `wc_${i}`,
      type: i < 15 ? "wildcard" : "constraint",
      name: `child ${i}`,
    }));
    apiBundles.list.mockResolvedValue({
      items: [{
        id: "bn_big", name: "Big", description: "", color: null, category_id: null,
        tags: [], is_favorite: false, children,
        payload_hash: "", version: 1, created_at: "", updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    await wrap.find(".wp-row-expand-btn").trigger("click");
    await flushPromises();

    // Capped at 8 of 20.
    expect(wrap.findAll(".wp-bundle-child")).toHaveLength(8);
    // The breakdown still says what the bundle is MADE of, dominant kind first.
    expect(wrap.find('[data-test="bundle-kind-summary"]').text())
      .toBe("15 wildcards · 5 constraints");

    // Toggle reveals the rest, then collapses back.
    const toggle = wrap.find('[data-test="bundle-children-toggle-bn_big"]');
    expect(toggle.text()).toBe("Show all 20");
    await toggle.trigger("click");
    expect(wrap.findAll(".wp-bundle-child")).toHaveLength(20);
    await wrap.find('[data-test="bundle-children-toggle-bn_big"]').trigger("click");
    expect(wrap.findAll(".wp-bundle-child")).toHaveLength(8);
  });

  it("does not offer a toggle when the child list fits under the cap", async () => {
    apiBundles.list.mockResolvedValue({
      items: [{
        id: "bn_small", name: "Small", description: "", color: null, category_id: null,
        tags: [], is_favorite: false,
        children: [{ id: "wc_1", type: "wildcard", name: "hair" }],
        payload_hash: "", version: 1, created_at: "", updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    await wrap.find(".wp-row-expand-btn").trigger("click");
    await flushPromises();
    expect(wrap.findAll(".wp-bundle-child")).toHaveLength(1);
    expect(wrap.find('[data-test="bundle-children-toggle-bn_small"]').exists()).toBe(false);
    expect(wrap.find('[data-test="bundle-kind-summary"]').text()).toBe("1 wildcard");
  });

  it("empty-state copy mentions creating bundles from Context", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Context");
  });

  it("renders default frame color via the --wp-bundle-default token when row.color is null", async () => {
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
    // Routes through `--wp-bundle-default` (slate per tokens.css) instead
    // of a hardcoded indigo literal so the list swatch, the canvas frame,
    // the Dashboard swatch, and the editor picker all stay in sync via
    // the token. The fallback hex `#334155` is the dark-theme value so
    // jsdom (no theme applied) reads the literal.
    expect(swatch.attributes("style") ?? "").toMatch(
      /var\(--wp-bundle-default,\s*#334155\)|rgb\(51,\s*65,\s*85\)/i,
    );
  });
});
