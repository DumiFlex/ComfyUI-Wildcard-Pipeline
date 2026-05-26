import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LoadTemplateModal from "./LoadTemplateModal.vue";

vi.mock("../../manager/api/client", () => ({
  api: {
    templates: {
      list: vi.fn(async () => ({
        items: [
          {
            id: "t1", name: "portrait", description: "", category_id: "c1", tags: ["style"],
            is_favorite: false, template_string: "$subject $style", created_at: "", updated_at: "",
          },
          {
            id: "t2", name: "landscape", description: "", category_id: null, tags: [],
            is_favorite: true, template_string: "$scene wide", created_at: "", updated_at: "",
          },
        ],
        total: 2,
      })),
    },
    categories: {
      list: vi.fn(async () => ({ items: [{ id: "c1", name: "Portraits" }] })),
    },
  },
}));

const stubs = { global: { stubs: { teleport: true } } };

describe("LoadTemplateModal", () => {
  it("lists templates + emits pick with the full row", async () => {
    const w = mount(LoadTemplateModal, { props: { open: true }, ...stubs });
    await flushPromises();
    expect(w.text()).toContain("portrait");
    await w.findAll('[data-test="load-tpl-row"]')[0].trigger("click");
    expect(w.emitted("pick")?.[0]?.[0]).toMatchObject({
      id: "t1", name: "portrait", template_string: "$subject $style",
    });
  });

  it("filters rows by search term", async () => {
    const w = mount(LoadTemplateModal, { props: { open: true }, ...stubs });
    await flushPromises();
    expect(w.findAll('[data-test="load-tpl-row"]')).toHaveLength(2);
    const search = w.find<HTMLInputElement>('[data-test="load-tpl-search"]');
    search.element.value = "landscape";
    await search.trigger("input");
    const visible = w.findAll('[data-test="load-tpl-row"]');
    expect(visible).toHaveLength(1);
    expect(visible[0].text()).toContain("landscape");
  });

  it("shows empty state when none", async () => {
    const { api } = await import("../../manager/api/client");
    (api.templates.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ items: [], total: 0 });
    const w = mount(LoadTemplateModal, { props: { open: true }, ...stubs });
    await flushPromises();
    expect(w.text()).toContain("No saved templates");
  });
});
