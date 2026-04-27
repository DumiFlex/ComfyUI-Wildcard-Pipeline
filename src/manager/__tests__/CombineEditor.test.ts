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
import CombineEditor from "../views/CombineEditor.vue";
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

describe("CombineEditor.vue", () => {
  it("renders 'New combine' heading when no id", async () => {
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New combine");
  });

  it("loads existing module when id prop given", async () => {
    apiMod.get.mockResolvedValue({
      id: "cb_a", name: "Subject", description: "", category_id: null,
      tags: [], type: "combine",
      payload: {
        template: "$first_name",
        output_var: "subject_phrase",
        input_vars: ["first_name"],
      },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(CombineEditor, {
      props: { id: "cb_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit combine");
    const outInput = wrap.find('[data-test="cb-output-var"]')
      .element as HTMLInputElement;
    expect(outInput.value).toBe("subject_phrase");
  });

  it("save without name does not call api", async () => {
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("save creates combine with type/payload shape", async () => {
    apiMod.create.mockResolvedValue({
      id: "cb_a", type: "combine", name: "Subject",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { template: "$first_name", output_var: "subject", input_vars: ["first_name"] },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Subject Phrase");
    await flushPromises();
    const ta = wrap.find('[data-test="cb-template"] textarea');
    await ta.setValue("$first_name with $hair_color hair");
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const call = apiMod.create.mock.calls[0]?.[0] as { type: string; payload: CombinePayload };
    expect(call.type).toBe("combine");
    expect(call.payload.template).toBe("$first_name with $hair_color hair");
    expect(call.payload.input_vars).toEqual(["first_name", "hair_color"]);
    expect(Object.keys(call.payload).sort()).toEqual(["input_vars", "output_var", "template"].sort());
  });

  it("detected inputs panel shows the $vars from the template", async () => {
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const ta = wrap.find('[data-test="cb-template"] textarea');
    await ta.setValue("$alpha plus $beta and $alpha again, $$literal");
    await flushPromises();
    const detected = wrap.find('[data-test="cb-detected"]');
    expect(detected.exists()).toBe(true);
    expect(detected.text()).toContain("$alpha");
    expect(detected.text()).toContain("$beta");
    expect(detected.text()).not.toContain("$literal");
  });
});
