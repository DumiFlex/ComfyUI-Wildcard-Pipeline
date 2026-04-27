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
import CombineForm from "../views/CombineForm.vue";
import type { CombinePayload } from "../api/types";

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
      { path: "/combines", component: { template: "<div/>" } },
    ],
  });
}

function findByText(wrap: ReturnType<typeof mount>, text: string) {
  return wrap.findAll("button").find((b) => b.text().includes(text));
}

describe("CombineForm.vue", () => {
  it("renders 'New combine' heading when no id", async () => {
    const wrap = mount(CombineForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New combine");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "cb_a",
      name: "Subject Phrase",
      description: "desc",
      category_id: null,
      tags: [],
      type: "combine",
      payload: {
        template: "$first_name with $hair_color hair",
        output_var: "subject_phrase",
        input_vars: ["first_name", "hair_color"],
      },
      version: 1,
      created_at: "",
      updated_at: "",
      is_favorite: false,
    });
    const wrap = mount(CombineForm, {
      props: { id: "cb_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit combine");
    expect(apiMod.get).toHaveBeenCalledWith("cb_a");
    const outInput = wrap.find('[data-test="cb-output-var"]')
      .element as HTMLInputElement;
    expect(outInput.value).toBe("subject_phrase");
  });

  it("save without name shows warn toast and does not call api", async () => {
    const wrap = mount(CombineForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("save creates combine with type/payload shape", async () => {
    apiMod.create.mockResolvedValue({
      id: "cb_a",
      type: "combine",
      name: "Subject Phrase",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload: {
        template: "$first_name with $hair_color hair",
        output_var: "subject_phrase",
        input_vars: ["first_name", "hair_color"],
      },
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mount(CombineForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();

    const nameInput = wrap.find("#cb-name");
    await nameInput.setValue("Subject Phrase");
    await flushPromises();

    // Type a template directly into the rich-text textarea.
    const ta = wrap.find('[data-test="cb-template"] textarea');
    await ta.setValue("$first_name with $hair_color hair");
    await flushPromises();

    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const call = apiMod.create.mock.calls[0]?.[0] as {
      type: string;
      payload: CombinePayload;
    };
    expect(call.type).toBe("combine");
    expect(call.payload.template).toBe("$first_name with $hair_color hair");
    expect(call.payload.output_var).toBe("subject_phrase");
    expect(call.payload.input_vars).toEqual(["first_name", "hair_color"]);
    // Strict shape — no extras.
    expect(Object.keys(call.payload).sort()).toEqual(
      ["input_vars", "output_var", "template"].sort(),
    );
  });

  it("detected inputs panel shows the $vars from the template", async () => {
    const wrap = mount(CombineForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();

    // Empty-state visible initially.
    expect(wrap.find('[data-test="cb-detected-empty"]').exists()).toBe(true);

    const ta = wrap.find('[data-test="cb-template"] textarea');
    await ta.setValue("$alpha plus $beta and $alpha again, $$literal");
    await flushPromises();

    const detected = wrap.find('[data-test="cb-detected"]');
    expect(detected.exists()).toBe(true);
    expect(detected.text()).toContain("$alpha");
    expect(detected.text()).toContain("$beta");
    // $$literal should not be a detected var.
    expect(detected.text()).not.toContain("$literal");
    // De-duplicated — only two chips.
    expect(detected.findAll(".cb-chip").length).toBe(2);
  });
});
