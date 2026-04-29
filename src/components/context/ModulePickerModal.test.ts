/**
 * Picker filter tests. Stub `fetch` so the modal's `reload` settles
 * with a known module + category set, then exercise the filter
 * controls and assert the visible row count narrows correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ModulePickerModal from "./ModulePickerModal.vue";

const mountOpts = { global: { stubs: { teleport: true } } } as const;

const FIXTURE_MODULES = [
  { id: "aaaaaaaa", type: "wildcard", name: "outfit",   payload: { var_binding: "outfit",   options: [] }, tags: ["clothing", "warm"], is_favorite: true,  category_id: "cat-clothing" },
  { id: "bbbbbbbb", type: "wildcard", name: "backdrop", payload: { var_binding: "backdrop", options: [] }, tags: ["scene"],            is_favorite: false, category_id: "cat-scene" },
  { id: "cccccccc", type: "wildcard", name: "props",    payload: { var_binding: "props",    options: [] }, tags: ["clothing"],         is_favorite: false, category_id: "cat-clothing" },
];

const FIXTURE_CATEGORIES = [
  { id: "cat-clothing", name: "Clothing" },
  { id: "cat-scene",    name: "Scene" },
];

function stubFetch(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => map[url] ?? {},
  }) as unknown as Response);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    stubFetch({
      "/wp/api/modules":    { items: FIXTURE_MODULES },
      "/wp/api/categories": { items: FIXTURE_CATEGORIES },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountReady() {
  const wrapper = mount(ModulePickerModal, {
    ...mountOpts,
    props: { visible: true, alreadyAdded: ["aaaaaaaa"] },
  });
  // Wait for the async reload to settle. Two microtask flushes cover
  // the Promise.allSettled + json() chain; an extra nextTick lets the
  // computed re-eval after `modules` / `categories` populate.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return wrapper;
}

/** Open the filters popover so tag chips + category select are
 *  reachable. Quick-toggle filters (favorites, hide-added) sit
 *  inline on the toolbar and don't need this. */
async function openFilters(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('[data-testid="picker-filter-trigger"]').trigger("click");
  await nextTick();
}

describe("ModulePickerModal — filters", () => {
  it("renders all modules by default (no filters active)", async () => {
    const wrapper = await mountReady();
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(3);
  });

  it("favorites toggle narrows to favorited modules only", async () => {
    const wrapper = await mountReady();
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("outfit");
  });

  it("hide-already-added toggle drops modules in the alreadyAdded set", async () => {
    const wrapper = await mountReady();
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(2);
    // outfit (aaaaaaaa) is excluded.
    expect(rows.find((r) => r.text().includes("outfit"))).toBeUndefined();
  });

  it("tag chip narrows to modules carrying that tag (AND across multi-select)", async () => {
    const wrapper = await mountReady();
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    let rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(2); // outfit + props
    // Add a second tag — AND-narrows to outfit only (warm + clothing).
    await wrapper.find('[data-testid="picker-tag-warm"]').trigger("click");
    rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("outfit");
  });

  it("category dropdown narrows to the chosen category", async () => {
    const wrapper = await mountReady();
    await openFilters(wrapper);
    const select = wrapper.find<HTMLSelectElement>('[data-testid="picker-filter-category"]');
    select.element.value = "cat-scene";
    await select.trigger("change");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("backdrop");
  });

  it("clear button resets every active filter", async () => {
    const wrapper = await mountReady();
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-clear"]').trigger("click");
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(3);
  });

  it("filters combine via AND (favorites + tag clothing → only outfit)", async () => {
    const wrapper = await mountReady();
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("outfit");
  });

  it("filter trigger badge shows count of active popover filters", async () => {
    const wrapper = await mountReady();
    // Initially no popover-tracked filters → no badge.
    expect(wrapper.find(".wp-picker__filter-badge").exists()).toBe(false);
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    await wrapper.find('[data-testid="picker-tag-warm"]').trigger("click");
    expect(wrapper.find(".wp-picker__filter-badge").text()).toBe("2");
  });

  it("inline favorites toggle works without opening the popover", async () => {
    const wrapper = await mountReady();
    expect(wrapper.find('[data-testid="picker-filter-pop"]').exists()).toBe(false);
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    // Popover stayed closed.
    expect(wrapper.find('[data-testid="picker-filter-pop"]').exists()).toBe(false);
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(1);
  });
});
