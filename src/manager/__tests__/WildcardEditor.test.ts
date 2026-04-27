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
import WildcardEditor from "../views/WildcardEditor.vue";

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
      { path: "/wildcards", component: { template: "<div/>" } },
    ],
  });
}

function findByText(wrap: ReturnType<typeof mount>, text: string) {
  return wrap.findAll("button").find((b) => b.text().includes(text));
}

describe("WildcardEditor.vue", () => {
  it("renders 'New wildcard' heading when no id", async () => {
    const wrap = mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
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
    const wrap = mount(WildcardEditor, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter()] },
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
    const wrap = mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("alpha");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wildcard", name: "alpha" }),
    );
  });

  it("save without name shows warn toast and does not call api", async () => {
    const wrap = mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("auto-derives var_binding from name while untouched", async () => {
    const wrap = mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Hair Color");
    await flushPromises();
    const varInput = wrap.find('[data-test="identity-var-binding"]')
      .element as HTMLInputElement;
    expect(varInput.value).toBe("hair_color");
  });

  it("save includes var_binding in payload", async () => {
    apiMod.create.mockResolvedValue({
      id: "wc_a", type: "wildcard", name: "Outfit Style",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { options: [], sub_categories: [], var_binding: "outfit_style" },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Outfit Style");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    const call = apiMod.create.mock.calls[0]?.[0] as { payload: { var_binding?: string } };
    expect(call.payload.var_binding).toBe("outfit_style");
  });

  it("renders RichTextInput for option values when editing", async () => {
    apiMod.get.mockResolvedValue({
      id: "wc_a", name: "alpha", description: "", category_id: null,
      tags: [], type: "wildcard",
      payload: { options: [{ id: "o1", value: "red", weight: 1 }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(WildcardEditor, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const rti = wrap.findComponent({ name: "RichTextInput" });
    expect(rti.exists()).toBe(true);
    expect(rti.props("modelValue")).toBe("red");
  });

  it("loads var_binding from existing payload", async () => {
    apiMod.get.mockResolvedValue({
      id: "wc_a", name: "Hair Color", description: "", category_id: null,
      tags: [], type: "wildcard",
      payload: { options: [], sub_categories: [], var_binding: "my_hair" },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(WildcardEditor, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const varInput = wrap.find('[data-test="identity-var-binding"]')
      .element as HTMLInputElement;
    expect(varInput.value).toBe("my_hair");
  });

  it("shows History (N) when payload has history entries", async () => {
    apiMod.get.mockResolvedValue({
      id: "wc_a", name: "alpha", description: "", category_id: null,
      tags: [], type: "wildcard",
      payload: {
        options: [{ id: "o1", value: "blue", weight: 1 }],
        sub_categories: [],
        var_binding: "alpha",
        history: [
          {
            saved_at: "2025-04-26T00:00:00Z",
            name: "older-name",
            description: "older",
            category_id: null,
            tags: [],
            payload: { options: [], sub_categories: [], var_binding: "older_name" },
          },
        ],
      },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });

    const wrap = mount(WildcardEditor, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();

    const historyBtn = wrap.find('[data-test="history-btn"]');
    expect(historyBtn.exists()).toBe(true);
    expect(historyBtn.text()).toContain("History (1)");
    wrap.unmount();
  });

  it("save on existing module appends to history sidecar", async () => {
    apiMod.get.mockResolvedValue({
      id: "wc_a", name: "alpha", description: "", category_id: null,
      tags: [], type: "wildcard",
      payload: { options: [], sub_categories: [], var_binding: "alpha" },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    apiMod.update.mockImplementation((_id: string, body: { payload: Record<string, unknown> }) => Promise.resolve({
      id: "wc_a", type: "wildcard", name: "alpha2",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: body.payload, version: 2, created_at: "", updated_at: "",
    }));
    const wrap = mount(WildcardEditor, {
      props: { id: "wc_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("alpha2");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.get).toHaveBeenCalledTimes(2);
    const upd = apiMod.update.mock.calls[0]?.[1] as { payload: { history?: unknown[] } };
    expect(Array.isArray(upd.payload.history)).toBe(true);
    expect(upd.payload.history?.length).toBe(1);
    wrap.unmount();
  });

  // Suppress unused helper warning.
  void findByText;
});
