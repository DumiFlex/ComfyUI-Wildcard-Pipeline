import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";

vi.mock("../../api/client", () => {
  const rows: Record<string, Record<string, unknown>> = {
    old1: {
      id: "old1", name: "old", description: "", category_id: null, tags: [],
      is_favorite: false, template_string: "$a", negative_template: null,
      created_at: "", updated_at: "",
    },
    neg1: {
      id: "neg1", name: "neg", description: "", category_id: null, tags: [],
      is_favorite: false, template_string: "$a", negative_template: "lowres, $negatives",
      created_at: "", updated_at: "",
    },
  };
  return {
    api: {
      templates: {
        list: vi.fn(async () => ({ items: Object.values(rows), total: 2 })),
        get: vi.fn(async (id: string) => rows[id]),
        update: vi.fn(async (id: string, b: Record<string, unknown>) => ({ ...rows[id], ...b })),
        create: vi.fn(async (b: Record<string, unknown>) => ({ id: "new1", ...b })),
      },
      categories: { list: vi.fn(async () => ({ items: [] })) },
    },
  };
});

import TemplateEditor from "../../views/TemplateEditor.vue";
import EditorFrame from "../../components/EditorFrame.vue";
import { api } from "../../api/client";

// A plain textarea stands in for the rich editor.
const RichTextInputStub = defineComponent({
  props: { modelValue: { type: String, default: "" }, ariaLabel: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h("textarea", {
      "aria-label": props.ariaLabel,
      value: props.modelValue,
      onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLTextAreaElement).value),
    });
  },
});

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/templates", component: { template: "<div/>" } },
      { path: "/templates/new", component: TemplateEditor },
      { path: "/templates/:id/edit", component: TemplateEditor, props: true },
    ],
  });
  await router.push(path);
  await router.isReady();
  const id = path.split("/")[2];
  const w = mount(TemplateEditor, {
    props: id && id !== "new" ? { id } : {},
    global: { plugins: [router], stubs: { RichTextInput: RichTextInputStub } },
  });
  await flushPromises();
  return w;
}

describe("TemplateEditor.vue — negative template", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads and saves the negative box", async () => {
    const w = await mountAt("/templates/neg1/edit");
    const neg = w.find<HTMLTextAreaElement>('textarea[aria-label="Negative template"]');
    expect(neg.element.value).toBe("lowres, $negatives");
    await neg.setValue("worst quality, $negatives");
    w.findComponent(EditorFrame).vm.$emit("save");
    await flushPromises();
    expect(api.templates.update).toHaveBeenCalledWith(
      "neg1", expect.objectContaining({ negative_template: "worst quality, $negatives" }),
    );
  });

  it("an old template left without a negative stays null", async () => {
    const w = await mountAt("/templates/old1/edit");
    w.findComponent(EditorFrame).vm.$emit("save");
    await flushPromises();
    expect(api.templates.update).toHaveBeenCalledWith(
      "old1", expect.objectContaining({ negative_template: null }),
    );
  });
});
