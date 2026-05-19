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
import RichTextInput from "../components/RichTextInput.vue";

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
      id: "cb_new", name: "Subject", description: "", category_id: null,
      tags: [], type: "combine",
      payload: { template: "$first_name walks", output_var: "subject_phrase", input_vars: ["first_name"] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    });
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();

    // Fill the name field (uses Input component → setValue).
    await wrap.find('[data-test="identity-name"]').setValue("Subject");

    // Drive the template via the RichTextInput's v-model emit — the host
    // is contenteditable so we don't simulate keystrokes; we emit the
    // serialised raw text the way `onHostInput` would after the user
    // typed it. This matches the production code path which reads
    // textContent off the host and emits update:modelValue.
    const rt = wrap.findComponent(RichTextInput);
    rt.vm.$emit("update:modelValue", "$first_name walks");
    await flushPromises();

    // Click Save.
    await wrap.find('[data-test="save-btn"]').trigger("click");
    await flushPromises();

    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const arg = apiMod.create.mock.calls[0][0] as {
      type: string;
      name: string;
      payload: { template: string; output_var: string; input_vars: string[] };
    };
    expect(arg.type).toBe("combine");
    expect(arg.name).toBe("Subject");
    expect(arg.payload.template).toBe("$first_name walks");
    // output_var defaults to `toIdentifier(name)` when the user hasn't edited it.
    expect(arg.payload.output_var).toBe("subject");
    // detected input_vars are derived from the template's $vars.
    expect(arg.payload.input_vars).toEqual(["first_name"]);
  });

  it("detected inputs panel shows the $vars from the template", async () => {
    const wrap = mount(CombineEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();

    // Empty template → empty panel hint.
    expect(wrap.text()).toContain("None — type a template above.");

    // Drive the template via the RichTextInput's v-model emit.
    const rt = wrap.findComponent(RichTextInput);
    rt.vm.$emit("update:modelValue", "$first_name and $last_name greet $first_name");
    await flushPromises();

    // Detected chips render in declared order with dedupe.
    const chipText = wrap.find('[data-test="cb-detected"]').text();
    expect(chipText).toContain("$first_name");
    expect(chipText).toContain("$last_name");
    // Header count reflects the dedup'd $var count.
    expect(wrap.text()).toContain("Detected inputs (2)");
  });
});
