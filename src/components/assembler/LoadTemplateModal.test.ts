import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LoadTemplateModal from "./LoadTemplateModal.vue";

vi.mock("../../manager/api/client", () => ({
  api: {
    templates: {
      list: vi.fn(async () => ({
        items: [{
          id: "t1", name: "portrait", description: "", category_id: null, tags: [],
          is_favorite: false, template_string: "$subject $style", created_at: "", updated_at: "",
        }],
        total: 1,
      })),
    },
  },
}));

describe("LoadTemplateModal", () => {
  it("lists templates + emits pick with the row", async () => {
    const w = mount(LoadTemplateModal, { props: { open: true }, global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.text()).toContain("portrait");
    await w.find('[data-test="load-tpl-row"]').trigger("click");
    expect(w.emitted("pick")?.[0]?.[0]).toMatchObject({ template_string: "$subject $style" });
  });

  it("shows empty state when none", async () => {
    const { api } = await import("../../manager/api/client");
    (api.templates.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ items: [], total: 0 });
    const w = mount(LoadTemplateModal, { props: { open: true }, global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.text()).toContain("No saved templates");
  });
});
