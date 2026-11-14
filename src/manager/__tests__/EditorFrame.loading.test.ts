import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
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
import EditorFrame from "../components/EditorFrame.vue";
import FixedEditor from "../views/FixedEditor.vue";
import DerivationEditor from "../views/DerivationEditor.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/fixed-values", component: { template: "<div/>" } },
      { path: "/derivations", component: { template: "<div/>" } },
    ],
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
  apiCat.list.mockResolvedValue({ items: [] });
});
afterEach(() => vi.clearAllMocks());

describe("EditorFrame loading", () => {
  const base = { title: "Edit thing", backRoute: "/", backLabel: "Back" };

  it("draws the editor skeleton, hides the body and holds Save", async () => {
    const w = mount(EditorFrame, {
      props: { ...base, loading: true, loadingLabel: "Loading thing" },
      slots: { default: '<p data-test="body">No options yet.</p>' },
      global: { plugins: [makeRouter()] },
      // jsdom only computes `display` for connected elements.
      attachTo: document.body,
    });
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(true);
    expect(w.find('[role="status"]').text()).toContain("Loading thing");
    expect(w.find('[data-test="body"]').isVisible()).toBe(false);
    expect(w.find('[data-test="save-btn"]').attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it("shows the body once loaded", async () => {
    const w = mount(EditorFrame, {
      props: { ...base, loading: false },
      slots: { default: '<p data-test="body">Body</p>' },
      global: { plugins: [makeRouter()] },
      attachTo: document.body,
    });
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(false);
    expect(w.find('[data-test="body"]').isVisible()).toBe(true);
    w.unmount();
  });

  it("draws an empty title as a skeleton line while loading", async () => {
    const w = mount(EditorFrame, {
      props: { ...base, title: "", loading: true },
      global: { plugins: [makeRouter()] },
    });
    expect(w.find(".wp-page__title .wp-skeleton").exists()).toBe(true);
  });
});

describe("module editors wait for the item", () => {
  const ROW = {
    id: "fv_a", name: "Defaults", description: "", category_id: null,
    tags: [], type: "fixed_values",
    payload: { values: [{ id: "v1", name: "first_name", value: "Alice" }] },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };

  it("FixedEditor shows the skeleton until the row lands", async () => {
    let resolve: (v: unknown) => void = () => {};
    apiMod.get.mockReturnValue(new Promise((r) => { resolve = r; }));
    const w = mount(FixedEditor, { props: { id: "fv_a" }, global: { plugins: [makeRouter()] } });
    await flushPromises();
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(true);
    resolve(ROW);
    await flushPromises();
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(false);
    expect((w.find('[data-test="fv-row-0-name"]').element as HTMLInputElement).value).toBe("first_name");
  });

  it("a new item never shows the skeleton", async () => {
    const w = mount(FixedEditor, { global: { plugins: [makeRouter()] } });
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(false);
  });

  it("DerivationEditor shows the skeleton, not \"No rules yet\", while loading", async () => {
    apiMod.get.mockReturnValue(new Promise(() => {}));
    const w = mount(DerivationEditor, {
      props: { id: "dv_a" },
      global: { plugins: [makeRouter()] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-test="editor-skeleton"]').exists()).toBe(true);
    expect(w.find(".wp-editor__content").isVisible()).toBe(false);
    w.unmount();
  });
});
