import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Same harness as the sibling WildcardEditor tests in src/manager/__tests__/ —
// mock the API client + drive a memory router so the editor mounts headless.
vi.mock("../../api/client", () => ({
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

import { api } from "../../api/client";
import WildcardEditor from "../WildcardEditor.vue";

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
      { path: "/wildcards", component: { template: "<div/>" } },
    ],
  });
}

/** Seed a saved wildcard with registry tags a/b/c and a single `fam`
 *  axis covering a+b — so the editor renders the `fam` box + an
 *  ungrouped box (holding `c`). */
function seedWildcard() {
  apiMod.get.mockResolvedValue({
    id: "wc_a",
    name: "palette",
    description: "",
    category_id: null,
    tags: [],
    type: "wildcard",
    payload: {
      var_binding: "palette",
      sub_categories: ["a", "b", "c"],
      tag_groups: { fam: ["a", "b"] },
      options: [
        { id: "o1", value: "red", weight: 1, sub_categories: ["a"] },
        { id: "o2", value: "blue", weight: 1, sub_categories: ["b", "c"] },
      ],
    },
    version: 1,
    created_at: "",
    updated_at: "",
    is_favorite: false,
  });
}

async function mountSeeded() {
  seedWildcard();
  const wrap = mount(WildcardEditor, {
    props: { id: "wc_a" },
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  return wrap;
}

describe("WildcardEditor sub-categories", () => {
  it("renders one group box per tag_groups axis + an ungrouped box", async () => {
    const w = await mountSeeded();
    // fam axis + ungrouped (c) = 2 boxes.
    expect(w.findAll('[data-test="subcat-group"]').length).toBe(2);
  });

  it("kebab menu offers rename/move/delete", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="subcat-kebab-a"]').trigger("click");
    expect(w.find('[data-test="subcat-rename"]').exists()).toBe(true);
    expect(w.find('[data-test="subcat-move"]').exists()).toBe(true);
    expect(w.find('[data-test="subcat-delete"]').exists()).toBe(true);
  });

  it("rejects an invalid new sub-category name", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="group-addtag-fam"]').trigger("click");
    await w.get('[data-test="group-addtag-input-fam"]').setValue("warm tones");
    await w.get('[data-test="group-addtag-input-fam"]').trigger("keydown.enter");
    expect(w.text()).toMatch(/whitespace/);
  });

  it("adds a valid tag to the right group and registry", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="group-addtag-fam"]').trigger("click");
    await w.get('[data-test="group-addtag-input-fam"]').setValue("green");
    await w.get('[data-test="group-addtag-input-fam"]').trigger("keydown.enter");
    await flushPromises();
    const vm = w.vm as unknown as {
      subCategories: string[];
      tagGroups: Record<string, string[]>;
    };
    expect(vm.subCategories).toContain("green");
    expect(vm.tagGroups.fam).toContain("green");
  });

  it("'+ Group' creates a new empty axis", async () => {
    const w = await mountSeeded();
    const before = w.findAll('[data-test="subcat-group"]').length;
    await w.get('[data-test="subcat-add-group"]').trigger("click");
    await flushPromises();
    const vm = w.vm as unknown as { tagGroups: Record<string, string[]> };
    // A new (empty) axis is now present in the reactive model.
    expect(Object.keys(vm.tagGroups).length).toBeGreaterThan(1);
    // And it surfaces as an additional group box.
    expect(w.findAll('[data-test="subcat-group"]').length).toBeGreaterThan(before);
  });

  it("serializes tag_groups back into the saved payload", async () => {
    apiMod.update.mockImplementation(
      (_id: string, body: { payload: Record<string, unknown> }) =>
        Promise.resolve({
          id: "wc_a",
          type: "wildcard",
          name: "palette",
          description: "",
          category_id: null,
          tags: [],
          is_favorite: false,
          payload: body.payload,
          version: 2,
          created_at: "",
          updated_at: "",
        }),
    );
    const w = await mountSeeded();
    await w.find('[data-test="save-btn"]').trigger("click");
    await flushPromises();
    const call = apiMod.update.mock.calls[0]?.[1] as {
      payload: { tag_groups?: Record<string, string[]> };
    };
    expect(call.payload.tag_groups).toEqual({ fam: ["a", "b"] });
  });

  it("clicking outside closes an open kebab menu", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="subcat-kebab-a"]').trigger("click");
    expect(w.find(".subcat-menu").exists()).toBe(true);
    // A click anywhere outside a pill / menu dismisses it (document-level
    // handler). Dispatch on body — outside the editor's detached subtree.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(w.find(".subcat-menu").exists()).toBe(false);
  });

  it("dragging a pill onto another box re-homes the tag", async () => {
    const w = await mountSeeded();
    const vm = w.vm as unknown as { tagGroups: Record<string, string[]> };
    expect(vm.tagGroups.fam).toEqual(["a", "b"]);
    // First pill is "a" in the fam box; drop it on the ungrouped box (2nd).
    await w.findAll(".subcat-pill")[0].trigger("dragstart");
    await w.findAll('[data-test="subcat-group"]')[1].trigger("drop");
    await flushPromises();
    expect(vm.tagGroups.fam).toEqual(["b"]); // "a" left the axis
  });
});
