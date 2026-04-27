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
import FixedValueForm from "../views/FixedValueForm.vue";

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

function findByText(wrap: ReturnType<typeof mount>, text: string) {
  return wrap.findAll("button").find((b) => b.text().includes(text));
}

describe("FixedValueForm.vue", () => {
  it("renders 'New fixed values' heading when no id", async () => {
    const wrap = mount(FixedValueForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New fixed values");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "fv_a", name: "Subject Profile", description: "desc",
      category_id: null, tags: [], type: "fixed_values",
      payload: { values: [{ id: "v1", name: "first_name", value: "Mira" }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(FixedValueForm, {
      props: { id: "fv_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit fixed values");
    expect(apiMod.get).toHaveBeenCalledWith("fv_a");
    const varInput = wrap.find('[data-test="fv-row-0-name"]')
      .element as HTMLInputElement;
    expect(varInput.value).toBe("first_name");
  });

  it("save without name shows warn toast and does not call api", async () => {
    const wrap = mount(FixedValueForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("save with invalid var name in row shows toast and skips api", async () => {
    const wrap = mount(FixedValueForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    // Fill module name so the first guard passes.
    const nameInput = wrap.find("#fv-name");
    await nameInput.setValue("Studio Defaults");
    // Add a row with a name starting with a digit (invalid identifier).
    const addBtn = wrap.find('[data-test="fv-add"]');
    await addBtn.trigger("click");
    await flushPromises();
    const varInput = wrap.find('[data-test="fv-row-0-name"]');
    // Setting "9bad" is allowed by the input sanitiser (digits allowed) but
    // fails VALID_IDENTIFIER_RE because identifiers can't start with a digit.
    await varInput.setValue("9bad");
    await flushPromises();
    // Inline error chip surfaces for the row.
    expect(wrap.find('[data-test="fv-row-0-err"]').exists()).toBe(true);
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("save sends payload with values shape", async () => {
    apiMod.create.mockResolvedValue({
      id: "fv_a", type: "fixed_values", name: "Studio Defaults",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { values: [] }, version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(FixedValueForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const nameInput = wrap.find("#fv-name");
    await nameInput.setValue("Studio Defaults");
    const addBtn = wrap.find('[data-test="fv-add"]');
    await addBtn.trigger("click");
    await flushPromises();
    const varInput = wrap.find('[data-test="fv-row-0-name"]');
    await varInput.setValue("focal_length");
    await flushPromises();
    const valInput = wrap.find('[data-test="fv-row-0-value"]');
    await valInput.setValue("85mm");
    await flushPromises();
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fixed_values", name: "Studio Defaults" }),
    );
    const call = apiMod.create.mock.calls[0]?.[0] as {
      payload: { values: { name: string; value: string }[] };
    };
    expect(call.payload.values).toHaveLength(1);
    expect(call.payload.values[0].name).toBe("focal_length");
    expect(call.payload.values[0].value).toBe("85mm");
  });

  it("flags duplicate var names as invalid rows", async () => {
    const wrap = mount(FixedValueForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const nameInput = wrap.find("#fv-name");
    await nameInput.setValue("Pack");
    const addBtn = wrap.find('[data-test="fv-add"]');
    await addBtn.trigger("click");
    await addBtn.trigger("click");
    await flushPromises();
    const a = wrap.find('[data-test="fv-row-0-name"]');
    const b = wrap.find('[data-test="fv-row-1-name"]');
    await a.setValue("dupe");
    await b.setValue("dupe");
    await flushPromises();
    expect(wrap.find('[data-test="fv-row-0-err"]').text()).toContain("Duplicate");
    expect(wrap.find('[data-test="fv-row-1-err"]').text()).toContain("Duplicate");
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("strips a leading $ from existing payload var names on load", async () => {
    apiMod.get.mockResolvedValue({
      id: "fv_a", name: "Pack", description: "",
      category_id: null, tags: [], type: "fixed_values",
      payload: { values: [{ id: "v1", name: "$age", value: "29" }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(FixedValueForm, {
      props: { id: "fv_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const varInput = wrap.find('[data-test="fv-row-0-name"]')
      .element as HTMLInputElement;
    expect(varInput.value).toBe("age");
  });
});
