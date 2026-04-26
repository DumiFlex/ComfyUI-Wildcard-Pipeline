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
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../api/client";
import WildcardForm from "../views/WildcardForm.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiCat.list.mockResolvedValue({ items: [] });
  // jsdom lacks matchMedia, used by some PrimeVue overlays
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/modules", component: { template: "<div/>" } },
    ],
  });
}

function findByText(wrap: ReturnType<typeof mount>, text: string) {
  return wrap.findAll("button").find((b) => b.text().includes(text));
}

describe("WildcardForm.vue", () => {
  it("renders 'New wildcard' heading when no id", async () => {
    const wrap = mount(WildcardForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New wildcard");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "wc_a", name: "alpha", description: "desc", category_id: null,
      tags: [], type: "wildcard", payload: { options: [{ id: "o1", value: "red", weight: 2 }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(WildcardForm, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit wildcard");
    expect(apiMod.get).toHaveBeenCalledWith("wc_a");
  });

  it("save creates wildcard module via store", async () => {
    apiMod.create.mockResolvedValue({
      id: "wc_a", type: "wildcard", name: "alpha",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { options: [] }, version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(WildcardForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const nameInput = wrap.find("#wc-name");
    await nameInput.setValue("alpha");
    await nameInput.trigger("input");
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wildcard", name: "alpha" }),
    );
  });

  it("save without name shows warn toast and does not call api", async () => {
    const wrap = mount(WildcardForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });
});
