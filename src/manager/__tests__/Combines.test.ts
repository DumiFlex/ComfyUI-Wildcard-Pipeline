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
import Combines from "../views/Combines.vue";

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
      { path: "/combines/new", component: { template: "<div/>" } },
      { path: "/combines/:id/edit", name: "combines-edit", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(Combines, {
    global: { plugins: [makeRouter(), PrimeVue, ToastService, ConfirmationService] },
  });
}

describe("Combines.vue", () => {
  it("filters store by type=combine on mount", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    mountView();
    await flushPromises();
    expect(apiMod.list).toHaveBeenCalledWith(expect.objectContaining({ type: "combine" }));
  });

  it("renders rows", async () => {
    apiMod.list.mockResolvedValue({
      items: [{
        id: "cb_a", type: "combine", name: "Subject Phrase", category_id: null,
        tags: [], is_favorite: false,
        payload: { template: "$name, $age", output_var: "subject", input_vars: ["$name", "$age"] },
        version: 1, description: "", created_at: "", updated_at: "",
      }],
      total: 1,
    });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Subject Phrase");
  });

  it("empty state shows CTA", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("No combines yet");
  });
});
