import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";

vi.mock("../api/client", () => ({
  api: {
    modules: {
      list: vi.fn(),
      delete: vi.fn(),
      duplicate: vi.fn(),
      favorite: vi.fn(),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../api/client";
import Modules from "../views/Modules.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/modules/wildcard/new", component: { template: "<div/>" } },
      { path: "/modules/fixed-values/new", component: { template: "<div/>" } },
      { path: "/modules/wildcard/:id", name: "wildcard-edit", component: { template: "<div/>" } },
      { path: "/modules/fixed-values/:id", name: "fixed-values-edit", component: { template: "<div/>" } },
    ],
  });
}

function mountModules() {
  const router = makeRouter();
  return mount(Modules, {
    global: { plugins: [router, PrimeVue, ToastService, ConfirmationService] },
  });
}

describe("Modules.vue", () => {
  it("renders rows after load", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "wc_a", type: "wildcard", name: "alpha", category_id: null, tags: [], is_favorite: false, payload: { options: [] }, version: 1, created_at: "", updated_at: "" },
        { id: "fv_b", type: "fixed_values", name: "beta", category_id: null, tags: [], is_favorite: false, payload: { values: [] }, version: 1, created_at: "", updated_at: "" },
      ],
      total: 2,
    });
    const wrap = mountModules();
    await flushPromises();
    expect(wrap.text()).toContain("alpha");
    expect(wrap.text()).toContain("beta");
  });

  it("type filter triggers refetch with type query", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountModules();
    await flushPromises();
    apiMod.list.mockClear();
    const wildcardBtn = wrap.find('[data-test="type-filter-wildcard"]');
    await wildcardBtn.trigger("click");
    await flushPromises();
    expect(apiMod.list).toHaveBeenCalledWith(expect.objectContaining({ type: "wildcard" }));
  });

  it("empty state renders when no modules", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountModules();
    await flushPromises();
    expect(wrap.text()).toContain("No modules yet");
  });

  it("module count shown in toolbar", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        { id: "wc_a", type: "wildcard", name: "alpha", category_id: null, tags: [], is_favorite: false, payload: {}, version: 1, created_at: "", updated_at: "" },
      ],
      total: 1,
    });
    const wrap = mountModules();
    await flushPromises();
    expect(wrap.text()).toContain("1 module");
  });
});
