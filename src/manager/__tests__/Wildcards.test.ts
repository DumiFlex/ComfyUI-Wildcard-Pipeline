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
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../api/client";
import Wildcards from "../views/Wildcards.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/wildcards/new", component: { template: "<div/>" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(Wildcards, {
    global: { plugins: [makeRouter(), PrimeVue, ToastService, ConfirmationService] },
  });
}

describe("Wildcards.vue", () => {
  it("filters store by type=wildcard on mount", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    mountView();
    await flushPromises();
    expect(apiMod.list).toHaveBeenCalledWith(expect.objectContaining({ type: "wildcard" }));
  });

  it("renders rows", async () => {
    apiMod.list.mockResolvedValue({
      items: [{
        id: "wc_a", type: "wildcard", name: "alpha", category_id: null,
        tags: [], is_favorite: false, payload: { options: [] }, version: 1,
        description: "", created_at: "", updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("alpha");
  });

  it("empty state shows New Wildcard CTA", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("No wildcards yet");
  });
});
