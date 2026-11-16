import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../../api/client", () => ({
  api: {
    modules: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    bundles: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    templates: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../../api/client";
import AllItems from "../../views/AllItems.vue";
import { useModuleStore } from "../../stores/moduleStore";

beforeEach(() => setActivePinia(createPinia()));

describe("AllItems.vue", () => {
  function mountPage() {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/:rest(.*)*", component: { template: "<div/>" } }] });
    return mount(AllItems, { global: { plugins: [router] } });
  }

  it("reads the stores' catalogs and fetches nothing while searching", async () => {
    vi.mocked(api.modules.list).mockResolvedValue({
      items: [
        { id: "aa11bb22", name: "Hair color", type: "wildcard", tags: [], payload: { options: [] } },
        { id: "cc33dd44", name: "Mood", type: "wildcard", tags: [], payload: { options: [] } },
      ],
      total: 2,
    } as never);
    const wrap = mountPage();
    await flushPromises();
    expect(vi.mocked(api.modules.list).mock.calls).toEqual([[{}]]);
    expect(vi.mocked(api.bundles.list).mock.calls).toEqual([[{}]]);
    expect(wrap.text()).toContain("Hair color");
    const search = wrap.find("input[aria-label=\"Search\"], input[type=search]");
    await search.setValue("hair");
    await flushPromises();
    expect(wrap.text()).toContain("Hair color");
    expect(wrap.text()).not.toContain("Mood");
    expect(vi.mocked(api.modules.list)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.bundles.list)).toHaveBeenCalledTimes(1);
  });

  it("shows a library change once the store's catalog is refreshed", async () => {
    const wrap = mountPage();
    await flushPromises();
    vi.mocked(api.modules.list).mockResolvedValueOnce({
      items: [{ id: "ee55ff66", name: "Fresh row", type: "wildcard", tags: [], payload: { options: [] } }],
      total: 1,
    } as never);
    await useModuleStore().fetchCatalog();
    await flushPromises();
    expect(wrap.text()).toContain("Fresh row");
  });
});
