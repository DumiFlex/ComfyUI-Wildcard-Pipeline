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
import { markLibraryChanged } from "../../composables/useLibraryChanged";

beforeEach(() => setActivePinia(createPinia()));

describe("AllItems.vue", () => {
  it("fetches the list again when a chat card changes the library", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/:rest(.*)*", component: { template: "<div/>" } }] });
    mount(AllItems, { global: { plugins: [router] } });
    await flushPromises();
    const before = vi.mocked(api.modules.list).mock.calls.length;
    markLibraryChanged();
    await flushPromises();
    expect(vi.mocked(api.modules.list).mock.calls.length).toBe(before + 1);
  });
});
