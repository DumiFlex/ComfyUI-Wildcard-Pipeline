import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Same harness as the H1 subcats test — mock the API client + memory router.
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
import type { WildcardOption } from "../../api/types";

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

/** Seed a saved wildcard whose single option o1 belongs to `feline`,
 *  with a registry that also offers `warm` (in a different axis) so the
 *  grouped picker has something to toggle on. */
function seedWildcard() {
  apiMod.get.mockResolvedValue({
    id: "wc_a",
    name: "subject",
    description: "",
    category_id: null,
    tags: [],
    type: "wildcard",
    payload: {
      var_binding: "subject",
      sub_categories: ["feline", "warm"],
      tag_groups: { species: ["feline"], temp: ["warm"] },
      options: [{ id: "o1", value: "cat", weight: 1, sub_categories: ["feline"] }],
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

function optionsOf(w: ReturnType<typeof mount>): WildcardOption[] {
  return (w.vm as unknown as { options: WildcardOption[] }).options;
}

describe("option multi-tag select", () => {
  it("renders a multi-select control per non-null option", async () => {
    const w = await mountSeeded();
    expect(w.find('[data-test="opt-tags-o1"]').exists()).toBe(true);
  });

  it("shows the currently-assigned tag and marks it on in the picker", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="opt-tags-o1"]').trigger("click"); // open picker
    expect(w.get('[data-test="opt-tag-toggle-o1-feline"]').classes()).toContain("is-on");
    // warm is a known registry tag but not assigned → not on.
    expect(w.get('[data-test="opt-tag-toggle-o1-warm"]').classes()).not.toContain("is-on");
  });

  it("toggles membership for an option", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="opt-tags-o1"]').trigger("click"); // open picker
    await w.get('[data-test="opt-tag-toggle-o1-warm"]').trigger("click"); // add warm
    await flushPromises();
    // Model now carries both tags.
    expect(optionsOf(w)[0].sub_categories).toEqual(["feline", "warm"]);
    // And the toggle reflects the on state.
    expect(w.get('[data-test="opt-tag-toggle-o1-warm"]').classes()).toContain("is-on");
  });

  it("removing an assigned tag updates the option model", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="opt-tags-o1"]').trigger("click");
    await w.get('[data-test="opt-tag-toggle-o1-feline"]').trigger("click"); // remove feline
    await flushPromises();
    expect(optionsOf(w)[0].sub_categories).toEqual([]);
  });

  it("keeps weight + value columns intact", async () => {
    const w = await mountSeeded();
    // The value RichTextInput + weight input still render for the option row.
    expect(w.findComponent({ name: "RichTextInput" }).exists()).toBe(true);
    const row = w.find('[data-test="wc-opt-row-0"]');
    expect(row.exists()).toBe(true);
    expect(row.find('input[type="number"]').exists()).toBe(true);
  });
});
