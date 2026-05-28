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
    categories: {
      list: vi.fn(async () => ({ items: [{ id: "c1", name: "Portraits" }] })),
    },
  },
}));

const stubs = { global: { stubs: { teleport: true } } };

describe("SaveTemplateModal", () => {
  it("blocks save when name empty", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, ...stubs });
    await flushPromises();
    expect(w.find('[data-test="save-tpl-submit"]').attributes("disabled")).toBeDefined();
  });

  it("detects same-name + offers update-existing AND save-as-new", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, ...stubs });
    await flushPromises();
    const input = w.find<HTMLInputElement>('[data-test="save-tpl-name"]');
    input.element.value = "existing";
    await input.trigger("input");
    await flushPromises();
    expect(w.find('[data-test="save-tpl-update-existing"]').exists()).toBe(true);
    expect(w.find('[data-test="save-tpl-save-new"]').exists()).toBe(true);
  });

  it("creates new on submit + emits saved", async () => {
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, ...stubs });
    await flushPromises();
    const input = w.find<HTMLInputElement>('[data-test="save-tpl-name"]');
    input.element.value = "fresh";
    await input.trigger("input");
    await w.find('[data-test="save-tpl-submit"]').trigger("click");
    await flushPromises();
    expect(w.emitted("saved")).toBeTruthy();
  });

  it("pushes a success toast on save", async () => {
    const { toasts } = await import("../shared/toast-store");
    const before = toasts.value.length;
    const w = mount(SaveTemplateModal, { props: { open: true, templateString: "$a" }, ...stubs });
    await flushPromises();
    const input = w.find<HTMLInputElement>('[data-test="save-tpl-name"]');
    input.element.value = "fresh";
    await input.trigger("input");
    await w.find('[data-test="save-tpl-submit"]').trigger("click");
    await flushPromises();
    const pushed = toasts.value.slice(before);
    expect(pushed.some((t) => t.severity === "success" && t.message.includes("fresh"))).toBe(true);
  });

  it("pre-fills name from loadedRef + Update targets its id", async () => {
    const w = mount(SaveTemplateModal, {
      props: { open: true, templateString: "$a", loadedRef: { id: "L1", name: "myloaded" } },
      ...stubs,
    });
    await flushPromises();
    expect(w.find<HTMLInputElement>('[data-test="save-tpl-name"]').element.value).toBe("myloaded");
    await w.find('[data-test="save-tpl-submit"]').trigger("click");
    await flushPromises();
    const { api } = await import("../../manager/api/client");
    expect(api.templates.update).toHaveBeenCalledWith("L1", expect.objectContaining({ name: "myloaded" }));
  });

  it("save-as-new creates even when a row with that name exists", async () => {
    const w = mount(SaveTemplateModal, {
      props: { open: true, templateString: "$a", loadedRef: { id: "L1", name: "myloaded" } },
      ...stubs,
    });
    await flushPromises();
    const { api } = await import("../../manager/api/client");
    (api.templates.create as ReturnType<typeof vi.fn>).mockClear();
    (api.templates.update as ReturnType<typeof vi.fn>).mockClear();
    await w.find('[data-test="save-tpl-save-new"]').trigger("click");
    await flushPromises();
    expect(api.templates.create).toHaveBeenCalled();
    expect(api.templates.update).not.toHaveBeenCalled();
  });
});
