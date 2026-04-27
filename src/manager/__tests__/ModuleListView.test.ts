import { mount, flushPromises } from "@vue/test-utils";
import { reactive, h } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import ModuleListView from "../components/ModuleListView.vue";

interface Row {
  id: string;
  name: string;
  updated_at: string;
  is_favorite?: boolean;
  tags?: string[];
}

interface Filter {
  q?: string;
  favorites?: boolean;
  category?: string | null;
  tags?: string[];
  sortBy?: string;
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/things/new", component: { template: "<div/>" } },
    ],
  });
}

function makeItems(n: number): Row[] {
  // Newest first sort baseline — generate descending updated_at strings.
  return Array.from({ length: n }, (_, i) => ({
    id: `r_${String(i).padStart(3, "0")}`,
    name: `Row ${i}`,
    updated_at: `2025-01-${String(31 - (i % 28)).padStart(2, "0")}T00:00:00Z`,
    tags: i % 2 === 0 ? ["even"] : ["odd"],
    is_favorite: i === 0,
  }));
}

function mountView(opts: {
  items: Row[];
  filter?: Filter;
  extraFilters?: { key: string; label: string; check: (r: Row) => boolean }[];
} = { items: [] }) {
  const filter = reactive<Filter>(opts.filter ?? {});
  const wrap = mount(ModuleListView<Row>, {
    props: {
      title: "Things",
      subtitle: "All the things",
      newLabel: "New Thing",
      newRoute: "/things/new",
      items: opts.items,
      loading: false,
      filter,
      emptyMessage: "No things yet.",
      extraFilters: opts.extraFilters,
      midCols: 0,
    },
    global: { plugins: [makeRouter()] },
    slots: {
      // No mid-cols — every visible row is just the built-in name + tags + updated.
      "columns-head": () => null,
      columns: () => null,
      actions: ({ row }: { row: Row }) =>
        h("button", { class: "wp-test-edit", "data-id": row.id }, "Edit"),
      expansion: ({ row }: { row: Row }) =>
        h("div", { class: "wp-test-expand" }, `Expanded: ${row.name}`),
    },
  });
  return { wrap, filter };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("ModuleListView.vue", () => {
  it("renders title, subtitle, and empty-state CTA", async () => {
    const { wrap } = mountView({ items: [] });
    await flushPromises();
    expect(wrap.text()).toContain("Things");
    expect(wrap.text()).toContain("All the things");
    expect(wrap.text()).toContain("No things yet.");
  });

  it("renders rows when items provided", async () => {
    const { wrap } = mountView({ items: makeItems(3) });
    await flushPromises();
    expect(wrap.text()).toContain("Row 0");
    expect(wrap.text()).toContain("Row 1");
    expect(wrap.text()).toContain("Row 2");
  });

  it("search input updates filter.q and emits fetch", async () => {
    const { wrap, filter } = mountView({ items: makeItems(3) });
    await flushPromises();
    const input = wrap.find('input[aria-label="Search"]');
    expect(input.exists()).toBe(true);
    await input.setValue("hello");
    expect(filter.q).toBe("hello");
    expect(wrap.emitted("fetch")).toBeTruthy();
  });

  it("toggling Filters opens the panel", async () => {
    const { wrap } = mountView({
      items: makeItems(3),
      extraFilters: [{ key: "fav", label: "Favorited", check: (r) => !!r.is_favorite }],
    });
    await flushPromises();
    expect(wrap.find(".wp-filter-panel").exists()).toBe(false);
    const filtersBtn = wrap.findAll("button").find((b) => b.text().includes("Filters"));
    expect(filtersBtn).toBeDefined();
    if (!filtersBtn) throw new Error("missing filters button");
    await filtersBtn.trigger("click");
    await flushPromises();
    expect(wrap.find(".wp-filter-panel").exists()).toBe(true);
    // Favorites quick-filter chip and extra-filter chips are both rendered.
    const toggleChips = wrap.findAll(".wp-chip--toggle");
    expect(toggleChips.length).toBeGreaterThanOrEqual(2);
    expect(toggleChips.some((c) => c.text().includes("Favorites only"))).toBe(true);
    expect(toggleChips.some((c) => c.text().includes("Favorited"))).toBe(true);
  });

  it("paginates 20 items into pages of 10 then 10 when pageSize=10", async () => {
    const { wrap } = mountView({ items: makeItems(20) });
    await flushPromises();
    // `defineExpose` re-wraps refs as primitives on `wrap.vm`, so reach into
    // the setup state via `$.exposed` to mutate them through real refs.
    interface Exposed {
      page: { value: number };
      pageSize: { value: number };
      paged: { value: Row[] };
      totalPages: { value: number };
      goToPage: (n: number) => void;
    }
    const exposed = (wrap.vm.$ as unknown as { exposed: Exposed }).exposed;
    exposed.pageSize.value = 10;
    await flushPromises();
    expect(exposed.totalPages.value).toBe(2);
    expect(exposed.paged.value.length).toBe(10);
    exposed.goToPage(2);
    await flushPromises();
    expect(exposed.paged.value.length).toBe(10);
    // Total of 20 unique items rendered across pages.
    const seen = new Set(exposed.paged.value.map((r) => r.id));
    exposed.goToPage(1);
    await flushPromises();
    exposed.paged.value.forEach((r) => seen.add(r.id));
    expect(seen.size).toBe(20);
  });

  it("active-filter chip removes its filter on click", async () => {
    const { wrap, filter } = mountView({
      items: makeItems(3),
      filter: { favorites: true, tags: ["even"] },
    });
    await flushPromises();
    const chips = wrap.findAll(".wp-chip");
    expect(chips.length).toBeGreaterThan(0);
    // Click the favorites chip's close button.
    const favChip = chips.find((c) => c.text().includes("Favorites only"));
    expect(favChip).toBeDefined();
    if (!favChip) throw new Error("missing favorite chip");
    await favChip.find(".wp-chip__close").trigger("click");
    await flushPromises();
    expect(filter.favorites).toBe(false);
  });

  it("expansion toggles when chevron clicked", async () => {
    const { wrap } = mountView({ items: makeItems(3) });
    await flushPromises();
    expect(wrap.find(".wp-test-expand").exists()).toBe(false);
    const expandBtn = wrap.find(".wp-row-expand-btn");
    expect(expandBtn.exists()).toBe(true);
    await expandBtn.trigger("click");
    await flushPromises();
    expect(wrap.find(".wp-test-expand").exists()).toBe(true);
    expect(wrap.find(".wp-test-expand").text()).toContain("Expanded: Row 0");
    // Toggle off.
    await expandBtn.trigger("click");
    await flushPromises();
    expect(wrap.find(".wp-test-expand").exists()).toBe(false);
  });

  it("hides pagination when items count below smallest page size (10)", async () => {
    const { wrap } = mountView({ items: makeItems(5) });
    await flushPromises();
    expect(wrap.find(".wp-page-pager").exists()).toBe(false);
  });

  it("shows pagination when items > 10", async () => {
    const { wrap } = mountView({ items: makeItems(20) });
    await flushPromises();
    expect(wrap.find(".wp-page-pager").exists()).toBe(true);
  });
});
