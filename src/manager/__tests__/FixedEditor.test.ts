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
import FixedEditor from "../views/FixedEditor.vue";

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
      { path: "/fixed-values", component: { template: "<div/>" } },
    ],
  });
}

describe("FixedEditor.vue", () => {
  it("renders 'New fixed values' heading when no id", async () => {
    const wrap = mount(FixedEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New fixed values");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "fv_a", name: "Defaults", description: "", category_id: null,
      tags: [], type: "fixed_values",
      payload: { values: [{ id: "v1", name: "first_name", value: "Alice" }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(FixedEditor, {
      props: { id: "fv_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit fixed values");
    const nameEl = wrap.find('[data-test="fv-row-0-name"]')
      .element as HTMLInputElement;
    expect(nameEl.value).toBe("first_name");
  });

  it("save without name shows warn toast and does not call api", async () => {
    const wrap = mount(FixedEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("flags invalid identifier rows with inline error", async () => {
    const wrap = mount(FixedEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Studio Defaults");
    const addBtn = wrap.find('[data-test="fv-add"]');
    await addBtn.trigger("click");
    await flushPromises();
    const varInput = wrap.find('[data-test="fv-row-0-name"]');
    await varInput.setValue("9bad");
    await flushPromises();
    expect(wrap.find('[data-test="fv-row-0-err"]').exists()).toBe(true);
  });

  it("save creates fixed_values payload", async () => {
    apiMod.create.mockResolvedValue({
      id: "fv_a", type: "fixed_values", name: "Studio",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { values: [{ id: "v1", name: "focal_length", value: "85mm" }] },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(FixedEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Studio");
    // Default editor has two blank rows — fill both with valid identifiers
    // so the save-time validator (unique non-empty names) passes.
    await wrap.find('[data-test="fv-row-0-name"]').setValue("focal_length");
    await wrap.find('[data-test="fv-row-1-name"]').setValue("aperture");
    // Value fields are RichTextInput components (contenteditable hosts).
    // `wrap.find().setValue` only works on form inputs; emit the
    // `update:modelValue` from the underlying component so the parent
    // v-model picks it up.
    const valueInputs = wrap.findAllComponents({ name: "RichTextInput" });
    valueInputs[0].vm.$emit("update:modelValue", "85mm");
    valueInputs[1].vm.$emit("update:modelValue", "f1.4");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fixed_values", name: "Studio" }),
    );
    const call = apiMod.create.mock.calls[0]?.[0] as { payload: { values: { name: string; value: string }[] } };
    expect(call.payload.values.some((v) => v.name === "focal_length" && v.value === "85mm")).toBe(true);
  });
});
