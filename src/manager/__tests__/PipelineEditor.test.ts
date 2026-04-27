import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";

vi.mock("../api/client", () => ({
  api: {
    modules: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../api/client";
import PipelineEditor from "../views/PipelineEditor.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
  apiCat.list.mockResolvedValue({ items: [] });
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/pipelines", component: { template: "<div/>" } },
    ],
  });
}

describe("PipelineEditor.vue", () => {
  it("renders 'New pipeline' heading when no id", async () => {
    const wrap = mount(PipelineEditor, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New pipeline");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "pl_a", name: "Portrait", description: "desc", category_id: null,
      tags: [], type: "pipeline",
      payload: { steps: [{ id: "s1", module_id: "wc_a", enabled: true }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(PipelineEditor, {
      props: { id: "pl_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit pipeline");
    expect(apiMod.get).toHaveBeenCalledWith("pl_a");
  });

  it("save without name shows warn toast and skips API", async () => {
    const wrap = mount(PipelineEditor, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("save with name calls api.modules.create with type=pipeline", async () => {
    apiMod.create.mockResolvedValue({
      id: "pl_a", type: "pipeline", name: "Portrait",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { steps: [] }, version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(PipelineEditor, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Portrait");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pipeline", name: "Portrait" }),
    );
    const call = apiMod.create.mock.calls[0]?.[0] as { payload: { steps: unknown[] } };
    expect(Array.isArray(call.payload.steps)).toBe(true);
  });
});
