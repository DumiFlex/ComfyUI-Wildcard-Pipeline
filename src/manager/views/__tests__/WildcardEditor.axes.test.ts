import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Same harness as the sibling WildcardEditor tests — mock the API client +
// drive a memory router so the editor mounts headless.
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

/** An outfit wildcard shaped like the reported one: a SHOES group whose tags
 *  an option carries several of at once. */
function seed(overrides: Record<string, unknown> = {}) {
  apiMod.get.mockResolvedValue({
    id: "wc_a",
    name: "outfit",
    description: "",
    category_id: null,
    tags: [],
    type: "wildcard",
    payload: {
      var_binding: "outfit",
      sub_categories: ["sneakers", "sandals", "casual"],
      tag_groups: { SHOES: ["sneakers", "sandals"] },
      options: [
        { id: "o1", value: "tee", weight: 1, sub_categories: ["sneakers", "sandals"] },
      ],
      ...overrides,
    },
    version: 1,
    created_at: "",
    updated_at: "",
    is_favorite: false,
  });
}

async function mountSeeded(overrides: Record<string, unknown> = {}) {
  seed(overrides);
  const wrap = mount(WildcardEditor, {
    props: { id: "wc_a" },
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  // The Sub-Categories card ships collapsed; every test here is about the
  // group headers inside it.
  // The panel default is now expanded-when-populated, so a seeded (populated)
  // wildcard opens on its own. Only click to open if it actually shipped
  // collapsed, otherwise the click would toggle it shut.
  if (wrap.find('[data-test="subcat-collapsed"]').exists()) {
    await wrap.get('[data-test="subcat-collapse"]').trigger("click");
    await flushPromises();
  }
  return wrap;
}

type EditorVm = {
  tagGroupKinds: Record<string, string>;
  tagGroups: Record<string, string[]>;
  renameGroup: (from: string, to: string) => void;
  ungroupAxis: (axis: string) => void;
};

describe("WildcardEditor tag-group kinds", () => {
  it("defaults an existing group to classify, with no promoted styling", async () => {
    const w = await mountSeeded();
    const btn = w.get('[data-test="group-kind-SHOES"]');
    expect(btn.attributes("aria-pressed")).toBe("false");
    expect(btn.classes()).not.toContain("subcat-group__kind--accepts");
  });

  it("stores the kind when a group is promoted", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="group-kind-SHOES"]').trigger("click");
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({ SHOES: "accepts" });
    expect(w.get('[data-test="group-kind-SHOES"]').attributes("aria-pressed")).toBe("true");
  });

  it("drops the key again on classify, so a default payload stays clean", async () => {
    const w = await mountSeeded({ tag_group_kinds: { SHOES: "accepts" } });
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({ SHOES: "accepts" });
    await w.get('[data-test="group-kind-SHOES"]').trigger("click");
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({});
  });

  it("refuses to promote a group whose name is not an identifier", async () => {
    // `$var.NAME` has to parse, so the editor is where this gets caught —
    // failing at save time would arrive after the work.
    const w = await mountSeeded({
      tag_groups: { "My Shoes": ["sneakers", "sandals"] },
    });
    const btn = w.get('[data-test="group-kind-My Shoes"]');
    await btn.trigger("click");
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({});
    // The button renders from state, so a refused promotion cannot leave the
    // control showing something that was never stored.
    expect(btn.attributes("aria-pressed")).toBe("false");
  });

  it("labels itself with the kind, so nothing needs a tooltip to be read", async () => {
    const w = await mountSeeded();
    expect(w.get('[data-test="group-kind-SHOES"]').text()).toBe("classify");
    await w.get('[data-test="group-kind-SHOES"]').trigger("click");
    expect(w.get('[data-test="group-kind-SHOES"]').text()).toBe("accepts");
  });

  it("is a real focusable button, reachable without a pointer", async () => {
    const w = await mountSeeded();
    const el = w.get('[data-test="group-kind-SHOES"]').element as HTMLElement;
    expect(el.tagName).toBe("BUTTON");
    expect(el.hasAttribute("disabled")).toBe(false);
  });

  it("shows its kind without being hovered", async () => {
    // Regression: an earlier version faded the classify capsule in on header
    // hover. A control you only see by accident is one most people never learn
    // exists, which is fatal for a capability nobody is looking for yet.
    const w = await mountSeeded();
    const el = w.get('[data-test="group-kind-SHOES"]').element as HTMLElement;
    expect(el.textContent?.trim()).toBe("classify");
    expect(el.className).not.toContain("hover-only");
  });

  it("the ungrouped box has no kind selector", async () => {
    const w = await mountSeeded();
    // `casual` is registry-but-ungrouped, so a trailing box renders for it.
    expect(w.findAll('[data-test^="group-kind-"]').length).toBe(1);
  });

  it("renaming a promoted group keeps its kind", async () => {
    // Regression: the kind map is keyed by NAME, so a rename that forgets to
    // carry it silently demotes the axis back to classify.
    const w = await mountSeeded({ tag_group_kinds: { SHOES: "accepts" } });
    (w.vm as unknown as EditorVm).renameGroup("SHOES", "FOOTWEAR");
    await flushPromises();
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({ FOOTWEAR: "accepts" });
  });

  it("renaming to a non-identifier demotes rather than storing an unreadable axis", async () => {
    const w = await mountSeeded({ tag_group_kinds: { SHOES: "accepts" } });
    (w.vm as unknown as EditorVm).renameGroup("SHOES", "My Shoes");
    await flushPromises();
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({});
  });

  it("ungrouping an axis drops its kind", async () => {
    // A kind naming no group is invalid payload — validate_payload rejects it.
    const w = await mountSeeded({ tag_group_kinds: { SHOES: "accepts" } });
    (w.vm as unknown as EditorVm).ungroupAxis("SHOES");
    await flushPromises();
    expect((w.vm as unknown as EditorVm).tagGroupKinds).toEqual({});
  });

  it("saves tag_group_kinds into the payload", async () => {
    const w = await mountSeeded();
    await w.get('[data-test="group-kind-SHOES"]').trigger("click");
    apiMod.update.mockResolvedValue({});
    await w.get('[data-test="save-btn"]').trigger("click");
    await flushPromises();
    const calls = apiMod.update.mock.calls;
    const payload = calls[calls.length - 1]?.[1]?.payload;
    expect(payload.tag_group_kinds).toEqual({ SHOES: "accepts" });
  });

  it("omits the key entirely when nothing is promoted", async () => {
    // The omission is what keeps every shipped wildcard byte-identical.
    const w = await mountSeeded();
    apiMod.update.mockResolvedValue({});
    await w.get('[data-test="save-btn"]').trigger("click");
    await flushPromises();
    const calls = apiMod.update.mock.calls;
    const payload = calls[calls.length - 1]?.[1]?.payload;
    expect("tag_group_kinds" in payload).toBe(false);
  });
});

describe("WildcardEditor — accepts-axis coverage advisory", () => {
  it("flags options that carry no tag for an accepts axis", async () => {
    const w = await mountSeeded({
      tag_group_kinds: { SHOES: "accepts" },
      options: [
        { id: "o1", value: "sneaker outfit", weight: 1, sub_categories: ["sneakers"] },
        { id: "o2", value: "shoeless", weight: 1, sub_categories: ["casual"] },
      ],
    });
    const note = w.find('[data-test="axis-coverage-SHOES"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("1 option");
    expect(note.text()).toContain("$outfit.SHOES");
    w.unmount();
  });

  it("stays silent when every option covers the accepts axis", async () => {
    const w = await mountSeeded({
      tag_group_kinds: { SHOES: "accepts" },
      options: [
        { id: "o1", value: "a", weight: 1, sub_categories: ["sneakers"] },
        { id: "o2", value: "b", weight: 1, sub_categories: ["sandals"] },
      ],
    });
    expect(w.find('[data-test="axis-coverage-SHOES"]').exists()).toBe(false);
    w.unmount();
  });

  it("does not flag a classify group", async () => {
    const w = await mountSeeded({
      tag_group_kinds: {},
      options: [
        { id: "o1", value: "a", weight: 1, sub_categories: ["sneakers"] },
        { id: "o2", value: "b", weight: 1, sub_categories: ["casual"] },
      ],
    });
    expect(w.find('[data-test="axis-coverage-SHOES"]').exists()).toBe(false);
    w.unmount();
  });

  it("excludes the null option from the coverage count", async () => {
    const w = await mountSeeded({
      tag_group_kinds: { SHOES: "accepts" },
      options: [
        { id: "o1", value: "a", weight: 1, sub_categories: ["sneakers"] },
        { id: "_null", value: "", weight: 1, is_null: true, sub_categories: [] },
      ],
    });
    expect(w.find('[data-test="axis-coverage-SHOES"]').exists()).toBe(false);
    w.unmount();
  });
});
