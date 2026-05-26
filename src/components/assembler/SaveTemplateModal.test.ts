import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SaveTemplateModal from "./SaveTemplateModal.vue";

vi.mock("../../manager/api/client", () => ({
  api: {
    templates: {
      list: vi.fn(async () => ({
        items: [{
          id: "x1", name: "existing", template_string: "", description: "",
          category_id: null, tags: [], is_favorite: false, created_at: "", updated_at: "",
        }],
        total: 1,
      })),
      create: vi.fn(async (b: Record<string, unknown>) => ({ id: "new1", ...b })),
      update: vi.fn(async (id: string, b: Record<string, unknown>) => ({ id, ...b })),
    },
  },
}));

describe("SaveTemplateModal", () => {
  it("blocks save when name empty", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.find('[data-test="save-tpl-submit"]').attributes("disabled")).toBeDefined();
  });

  it("detects same-name + offers update-existing", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, global: { stubs: { teleport: true } } });
    await flushPromises();
    const input = w.find<HTMLInputElement>('[data-test="save-tpl-name"]');
    input.element.value = "existing";
    await input.trigger("input");
    await flushPromises();
    expect(w.find('[data-test="save-tpl-update-existing"]').exists()).toBe(true);
  });

  it("creates new on submit + emits saved", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, global: { stubs: { teleport: true } } });
    await flushPromises();
    const input = w.find<HTMLInputElement>('[data-test="save-tpl-name"]');
    input.element.value = "fresh";
    await input.trigger("input");
    await w.find('[data-test="save-tpl-submit"]').trigger("click");
    await flushPromises();
    expect(w.emitted("saved")).toBeTruthy();
  });
});
