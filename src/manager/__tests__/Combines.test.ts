import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
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
import { useModuleStore } from "../stores/moduleStore";

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
    global: { plugins: [makeRouter()] },
  });
}

describe("Combines.vue", () => {
  it("shows only combine rows, filtered from the catalog on the client", async () => {
    const row = (id: string, type: string) => ({
      id, type, name: id, category_id: null, tags: [], is_favorite: false,
      payload: {}, version: 1, description: "", created_at: "", updated_at: "",
    });
    apiMod.list.mockResolvedValue({ items: [row("mine01", "combine"), row("other1", "wildcard")], total: 2 });
    mountView();
    await flushPromises();
    // One unfiltered catalog fetch, no per-kind request.
    expect(apiMod.list).toHaveBeenCalledTimes(1);
    expect(apiMod.list).toHaveBeenCalledWith({});
    const store = useModuleStore();
    expect(store.filter.type).toBe("combine");
    expect(store.items.map((r) => r.id)).toEqual(["mine01"]);
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
