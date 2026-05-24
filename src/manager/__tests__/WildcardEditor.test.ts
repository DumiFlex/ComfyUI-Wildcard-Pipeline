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
    // Field-error rollup (Task 4.7) blocks save when any option is empty.
    // Fill in non-empty values so the save() path proceeds to apiMod.create.
    const vm = wrap.vm as unknown as { options: { value: string }[] };
    vm.options[0].value = "red";
    vm.options[1].value = "blue";
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
    const vm = wrap.vm as unknown as { options: { value: string }[] };
    vm.options[0].value = "red";
    vm.options[1].value = "blue";
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
      payload: {
        options: [{ id: "o1", value: "red", weight: 1 }],
        sub_categories: [],
        var_binding: "alpha",
      },
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

describe("WildcardEditor — null option", () => {
  // Fresh-mount seeds 2 blank options so "before any null click" baseline
  // is .length === 2. Tests assert relative changes from there.
  const BASELINE = 2;

  function mountFresh() {
    return mount(WildcardEditor, {
      global: { plugins: [makeRouter()] },
    });
  }

  it('"+ Add null" inserts one is_null=true option at index 0', async () => {
    const wrap = mountFresh();
    await flushPromises();
    await wrap.find('[data-test="wc-add-null"]').trigger("click");
    const vm = wrap.vm as unknown as { options: { is_null?: boolean; value: string }[] };
    expect(vm.options.length).toBe(BASELINE + 1);
    expect(vm.options[0].is_null).toBe(true);
    expect(vm.options[0].value).toBe("");
    wrap.unmount();
  });

  it('"+ Add null" is no-op when a null option already exists', async () => {
    const wrap = mountFresh();
    await flushPromises();
    await wrap.find('[data-test="wc-add-null"]').trigger("click");
    await flushPromises();
    const btn = wrap.find('[data-test="wc-add-null"]');
    // Either the button is disabled or clicking it is a no-op.
    await btn.trigger("click");
    await flushPromises();
    const vm = wrap.vm as unknown as { options: { is_null?: boolean }[] };
    expect(vm.options.filter((o) => o.is_null).length).toBe(1);
    wrap.unmount();
  });

  it("renders pi-ban chip on the null option row and hides the sub-cat select", async () => {
    const wrap = mountFresh();
    await flushPromises();
    await wrap.find('[data-test="wc-add-null"]').trigger("click");
    await flushPromises();
    const row = wrap.find('[data-test="wc-opt-row-null"]');
    expect(row.exists()).toBe(true);
    expect(row.find(".pi-ban").exists()).toBe(true);
    // Sub-cat select is hidden when the row is the null option.
    expect(row.find('[data-test="wc-opt-subcat"]').exists()).toBe(false);
    wrap.unmount();
  });

  it("after adding a normal option, null option stays at index 0", async () => {
    const wrap = mountFresh();
    await flushPromises();
    await wrap.find('[data-test="wc-add-null"]').trigger("click");
    await wrap.find('[data-test="wc-add-opt"]').trigger("click");
    await flushPromises();
    const vm = wrap.vm as unknown as { options: { is_null?: boolean }[] };
    expect(vm.options[0].is_null).toBe(true);
    expect(vm.options.slice(1).every((o) => !o.is_null)).toBe(true);
    wrap.unmount();
  });
});
