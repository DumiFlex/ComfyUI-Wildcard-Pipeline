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

/** No-op shim — V1 made the filter strip always-visible, so tag
 *  chips + category pills are reachable without opening anything.
 *  Kept as a shim so test diffs stay small and intent stays
 *  obvious for any future filter-row helper. */
async function openFilters(_wrapper: ReturnType<typeof mount>) {
  await nextTick();
}

describe("ModulePickerModal — filters", () => {
  it("renders all modules by default (no filters active)", async () => {
    const wrapper = await mountReady();
    // hide-already-added is ON by default; outfit (aaaaaaaa) is in alreadyAdded
    // so it is hidden → 2 visible rows (backdrop + props).
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(2);
  });

  it("favorites toggle narrows to favorited modules only", async () => {
    const wrapper = await mountReady();
    // Turn off hide-already-added first so outfit (the only favorite) is visible.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("outfit");
  });

  it("hide-already-added toggle default ON hides already-added module; toggling OFF restores it", async () => {
    const wrapper = await mountReady();
    // Default: hide-already-added ON → outfit hidden, 2 rows.
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(2);
    // Toggle OFF → outfit visible, 3 rows.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.text().includes("outfit"))).toBeDefined();
  });

  it("tag chip narrows to modules carrying that tag (AND across multi-select)", async () => {
    const wrapper = await mountReady();
    // Turn off hide-already-added so outfit is visible.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
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

  it("category pill narrows to the chosen category", async () => {
    const wrapper = await mountReady();
    // V1 — categories are pills now, not a dropdown.
    await wrapper.find('[data-testid="picker-filter-category-cat-scene"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("backdrop");
  });

  it("clear button resets every active filter", async () => {
    const wrapper = await mountReady();
    // Turn off hide-already-added so favorites + tag can include outfit.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-clear"]').trigger("click");
    // clearAllFilters resets hideAlreadyAdded → false, so all 3 rows are visible.
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(3);
  });

  it("filters combine via AND (favorites + tag clothing → only outfit)", async () => {
    const wrapper = await mountReady();
    // Turn off hide-already-added so outfit (the only favorite) is visible.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    await openFilters(wrapper);
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("outfit");
  });

  it("inline 'clear (N)' pill reflects the active filter count", async () => {
    const wrapper = await mountReady();
    // Default state — hide-already-added is on by default → count 1.
    let clear = wrapper.find('[data-testid="picker-filter-clear"]');
    expect(clear.exists()).toBe(true);
    expect(clear.text()).toContain("(1)");
    // Stack two more filters — tag clothing + tag warm → count 3.
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    await wrapper.find('[data-testid="picker-tag-warm"]').trigger("click");
    clear = wrapper.find('[data-testid="picker-filter-clear"]');
    expect(clear.text()).toContain("(3)");
  });

  it("inline favorites toggle works without any popover step", async () => {
    const wrapper = await mountReady();
    // Turn off hide-already-added so outfit (the only favorite) is visible.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    await wrapper.find('[data-testid="picker-filter-favorites"]').trigger("click");
    expect(wrapper.findAll(".wp-picker__row")).toHaveLength(1);
  });
});

// ── mountPicker helper ────────────────────────────────────────────────────────
// Stubs fetch so the component's reload() resolves immediately with the
// provided modules array (no categories needed for multi-select tests).
// ModalShell is stubbed with a plain passthrough div to avoid the slot
// re-mounting issue that the teleport:true stub causes: with Teleport
// stubbed at the ModalShell level, Vue re-creates (rather than patches)
// the v-for row elements on re-render, making DOMWrapper references stale.
async function mountPicker(opts: {
  modules: Array<{ id: string; type: string; name: string; payload: Record<string, unknown> }>;
  alreadyAddedIds?: string[];
}) {
  vi.stubGlobal(
    "fetch",
    stubFetch({
      "/wp/api/modules":    { items: opts.modules },
      "/wp/api/categories": { items: [] },
    }),
  );
  const wrapper = mount(ModulePickerModal, {
    global: {
      stubs: {
        teleport: true,
        ModalShell: { template: "<div><slot /></div>" },
      },
    },
    props: {
      visible: true,
      alreadyAdded: opts.alreadyAddedIds ?? [],
      alreadyAddedIds: opts.alreadyAddedIds,
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return wrapper;
}

describe("ModulePickerModal multi-select", () => {
  it("renders a checkbox cell on every row", async () => {
    const wrapper = await mountPicker({
      modules: [
        { id: "a1", type: "wildcard", name: "hair_style", payload: {} },
        { id: "b2", type: "fixed_values", name: "style_pack", payload: {} },
      ],
    });
    expect(wrapper.findAll('[data-test="picker-checkbox"]')).toHaveLength(2);
  });

  it("clicking a row toggles its checkbox", async () => {
    const wrapper = await mountPicker({
      modules: [{ id: "a1", type: "wildcard", name: "hair_style", payload: {} }],
    });
    const row = wrapper.find('[data-test="picker-row-a1"]');
    await row.trigger("click");
    expect(row.find('[data-test="picker-checkbox"]').classes()).toContain("on");
    await row.trigger("click");
    expect(row.find('[data-test="picker-checkbox"]').classes()).not.toContain("on");
  });

  it("footer button label updates with selection count", async () => {
    const wrapper = await mountPicker({
      modules: [
        { id: "a1", type: "wildcard", name: "hair_style", payload: {} },
        { id: "b2", type: "wildcard", name: "mood", payload: {} },
      ],
    });
    expect(wrapper.find('[data-test="picker-add-btn"]').text()).toMatch(/Add 0 modules/);
    await wrapper.find('[data-test="picker-row-a1"]').trigger("click");
    expect(wrapper.find('[data-test="picker-add-btn"]').text()).toMatch(/Add 1 module/);
    await wrapper.find('[data-test="picker-row-b2"]').trigger("click");
    expect(wrapper.find('[data-test="picker-add-btn"]').text()).toMatch(/Add 2 modules/);
  });

  it("Add button emits all selected module ids on click", async () => {
    const wrapper = await mountPicker({
      modules: [
        { id: "a1", type: "wildcard", name: "hair_style", payload: {} },
        { id: "b2", type: "wildcard", name: "mood", payload: {} },
      ],
    });
    await wrapper.find('[data-test="picker-row-a1"]').trigger("click");
    await wrapper.find('[data-test="picker-row-b2"]').trigger("click");
    await wrapper.find('[data-test="picker-add-btn"]').trigger("click");
    const events = wrapper.emitted("add");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toEqual(["a1", "b2"]);
  });
});

describe("ModulePickerModal — multi-kind picking (post 5.5.6)", () => {
  /**
   * Lock the post-5.5.6 contract: every embeddable kind with a payload
   * is pickable. Pre-5.5.6 the picker hard-gated to wildcard-only.
   * Pipeline is intentionally excluded from the picker until the modal
   * grows a pipeline preview (deferred sub-task) — assert it's filtered
   * out of the visible list rather than rendered as a disabled row.
   */
  it("renders every embeddable kind enabled and hides pipelines", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "/wp/api/modules": {
          items: [
            { id: "aaaaaaaa", type: "wildcard",     name: "wc",   payload: { options: [] }, tags: [], is_favorite: false, category_id: null },
            { id: "bbbbbbbb", type: "combine",      name: "cmb",  payload: { template: "$x" }, tags: [], is_favorite: false, category_id: null },
            { id: "cccccccc", type: "derivation",   name: "der",  payload: { rules: [] }, tags: [], is_favorite: false, category_id: null },
            { id: "dddddddd", type: "constraint",   name: "con",  payload: { matrix: {} }, tags: [], is_favorite: false, category_id: null },
            { id: "eeeeeeee", type: "fixed_values", name: "fv",   payload: { values: [] }, tags: [], is_favorite: false, category_id: null },
            { id: "ffffffff", type: "pipeline",     name: "pipe", payload: { steps: [] }, tags: [], is_favorite: false, category_id: null },
          ],
        },
        "/wp/api/categories": { items: [] },
      }),
    );
    const wrapper = mount(ModulePickerModal, {
      ...mountOpts,
      props: { visible: true, alreadyAdded: [] },
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    const rows = wrapper.findAll(".wp-picker__row");
    // 5 visible — wildcard, combine, derivation, constraint, fixed_values.
    // Pipeline filtered out of the visible list entirely.
    expect(rows.length).toBe(5);
    expect(wrapper.text()).not.toContain("pipe");
    // Every visible row should be enabled — no `data-disabled` attribute.
    for (const row of rows) {
      expect(row.attributes("data-disabled")).toBeUndefined();
    }
    // No "Pipelines" tab in the strip.
    expect(wrapper.text()).not.toContain("Pipelines");
  });

  it("disables a row whose payload is missing", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "/wp/api/modules": {
          items: [
            { id: "aaaaaaaa", type: "combine", name: "broken", payload: undefined, tags: [], is_favorite: false, category_id: null },
          ],
        },
        "/wp/api/categories": { items: [] },
      }),
    );
    const wrapper = mount(ModulePickerModal, {
      ...mountOpts,
      props: { visible: true, alreadyAdded: [] },
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    const row = wrapper.find(".wp-picker__row");
    expect(row.exists()).toBe(true);
    expect(row.attributes("data-disabled")).toBe("true");
  });
});

describe("ModulePickerModal hide-already-added", () => {
  it("dims rows whose id is in alreadyAddedIds", async () => {
    const wrapper = await mountPicker({
      modules: [
        { id: "a1", type: "wildcard", name: "hair_style", payload: {} },
        { id: "b2", type: "wildcard", name: "mood", payload: {} },
      ],
      alreadyAddedIds: ["a1"],
    });
    // hide-already-added is ON by default → row a1 hidden, only b2 visible.
    expect(wrapper.find('[data-test="picker-row-a1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="picker-row-b2"]').exists()).toBe(true);
  });

  it("toggling the pill OFF re-shows already-added rows with dimmed style", async () => {
    const wrapper = await mountPicker({
      modules: [
        { id: "a1", type: "wildcard", name: "hair_style", payload: {} },
        { id: "b2", type: "wildcard", name: "mood", payload: {} },
      ],
      alreadyAddedIds: ["a1"],
    });
    await wrapper.find('[data-test="hide-added-toggle"]').trigger("click");
    const row = wrapper.find('[data-test="picker-row-a1"]');
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain("is-already-added");
  });
});

/** Synchronous mount for static-markup tests (tabs, CSS classes).
 *  Tabs are rendered immediately on mount — no fetch round-trip needed. */
function mountPickerSync(opts: {
  modules: Array<{ id: string; type: string; name: string; payload: Record<string, unknown> }>;
}) {
  vi.stubGlobal(
    "fetch",
    stubFetch({
      "/wp/api/modules":    { items: opts.modules },
      "/wp/api/categories": { items: [] },
    }),
  );
  return mount(ModulePickerModal, {
    global: {
      stubs: {
        teleport: true,
        ModalShell: { template: "<div><slot /></div>" },
      },
    },
    props: { visible: true, alreadyAdded: [] },
  });
}

describe("ModulePickerModal kind tabs", () => {
  it("renders 6 kind tabs (All + 5 kinds)", () => {
    const wrapper = mountPickerSync({ modules: [] });
    expect(wrapper.findAll(".wp-picker-tab")).toHaveLength(6);
  });

  it("each kind tab uses the canonical PrimeIcons class", () => {
    const wrapper = mountPickerSync({ modules: [] });
    const wcTab = wrapper.find('[data-test="picker-tab-wildcard"]');
    expect(wcTab.find("i").classes().join(" ")).toContain("pi-sparkles");
    const fxTab = wrapper.find('[data-test="picker-tab-fixed_values"]');
    expect(fxTab.find("i").classes().join(" ")).toContain("pi-tag");
    const cnTab = wrapper.find('[data-test="picker-tab-constraint"]');
    expect(cnTab.find("i").classes().join(" ")).toContain("pi-filter");
  });
});

// ── V1: always-visible filter strip (mockup v5 lines 932-942) ───────────
// Replaces the popover trigger with an inline filter strip below the kind
// tabs. Category pills + tag chips + clear pill are always rendered when
// the underlying data exists.

describe("ModulePickerModal — V1 always-visible filter strip", () => {
  it("renders the .wp-picker-filters strip without needing a trigger click", async () => {
    const wrapper = await mountReady();
    // Strip is rendered immediately — no popover trigger to click.
    expect(wrapper.find(".wp-picker-filters").exists()).toBe(true);
    // Old popover trigger is gone (was data-testid="picker-filter-trigger").
    expect(wrapper.find('[data-testid="picker-filter-trigger"]').exists()).toBe(false);
  });

  it("category pills + tag chips are reachable without opening anything", async () => {
    const wrapper = await mountReady();
    // Category pill for the fixture's "Clothing" category.
    expect(wrapper.find('[data-testid="picker-filter-category-cat-clothing"]').exists()).toBe(true);
    // Tag chips already had data-testid; they live inside the strip now.
    expect(wrapper.find('[data-testid="picker-tag-clothing"]').exists()).toBe(true);
  });

  it("clicking a category pill narrows rows to that category", async () => {
    const wrapper = await mountReady();
    await wrapper.find('[data-testid="picker-filter-category-cat-scene"]').trigger("click");
    const rows = wrapper.findAll(".wp-picker__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("backdrop");
  });

  it("inline 'clear (N)' pill appears only when at least one filter is active", async () => {
    const wrapper = await mountReady();
    // Default state — hide-already-added is on by default (counts as active filter).
    // Toggle it off so we start from a fully clean slate.
    await wrapper.find('[data-testid="picker-filter-hide-added"]').trigger("click");
    expect(wrapper.find('[data-testid="picker-filter-clear"]').exists()).toBe(false);
    // Activate one filter → clear pill appears.
    await wrapper.find('[data-testid="picker-tag-clothing"]').trigger("click");
    expect(wrapper.find('[data-testid="picker-filter-clear"]').exists()).toBe(true);
  });
});
