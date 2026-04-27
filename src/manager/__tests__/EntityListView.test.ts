import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import Column from "primevue/column";
import EntityListView from "../components/EntityListView.vue";

interface Row {
  id: string;
  name: string;
  updated_at: string;
  is_favorite?: boolean;
  tags?: string[];
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

interface Filter {
  q?: string;
  favorites?: boolean;
  category?: string;
  tags?: string[];
  sortBy?: string;
}

function mountView(opts: {
  items: Row[];
  filter?: Filter;
  extraFilters?: { key: string; label: string; check: (r: Row) => boolean }[];
} = { items: [] }) {
  const filter = reactive<Filter>(opts.filter ?? {});
  const wrap = mount(EntityListView<Row>, {
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
    },
    global: {
      plugins: [makeRouter(), PrimeVue, ToastService, ConfirmationService],
      components: { Column },
    },
    slots: {
      columns: `<Column field="name" header="Name" />`,
    },
  });
  return { wrap, filter };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("EntityListView.vue", () => {
  it("renders title, subtitle, and empty-state CTA when no items + no filters", async () => {
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

  it("hides pagination footer when items count below smallest page size", async () => {
    const { wrap } = mountView({ items: makeItems(5) });
    await flushPromises();
    expect(wrap.find(".wp-pagination").exists()).toBe(false);
  });

  it("shows pagination footer + correct counts when more than 10 items", async () => {
    const { wrap } = mountView({ items: makeItems(20) });
    await flushPromises();
    expect(wrap.find(".wp-pagination").exists()).toBe(true);
    // Default pageSize = 15, total = 20, so first page shows 1–15 of 20.
    const text = wrap.find(".wp-pagination").text();
    expect(text).toContain("1");
    expect(text).toContain("15");
    expect(text).toContain("20");
  });

  it("disables prev/first on page 1 and enables next/last", async () => {
    const { wrap } = mountView({ items: makeItems(40) });
    await flushPromises();
    const buttons = wrap.find(".wp-pager").findAll("button");
    // Order: first, prev, next, last (label spans between prev and next).
    expect(buttons[0].attributes("disabled")).toBeDefined();
    expect(buttons[1].attributes("disabled")).toBeDefined();
    expect(buttons[2].attributes("disabled")).toBeUndefined();
    expect(buttons[3].attributes("disabled")).toBeUndefined();
  });

  it("disables next/last after navigating to last page", async () => {
    const { wrap } = mountView({ items: makeItems(40) });
    await flushPromises();
    const inst = wrap.vm as unknown as { goToPage: (n: number) => void };
    inst.goToPage(99);
    await flushPromises();
    const buttons = wrap.find(".wp-pager").findAll("button");
    expect(buttons[0].attributes("disabled")).toBeUndefined();
    expect(buttons[1].attributes("disabled")).toBeUndefined();
    expect(buttons[2].attributes("disabled")).toBeDefined();
    expect(buttons[3].attributes("disabled")).toBeDefined();
  });

  it("active filter count includes category, favorites, and each tag", async () => {
    const { wrap } = mountView({
      items: makeItems(3),
      filter: { category: "cat-1", favorites: true, tags: ["a", "b"] },
    });
    await flushPromises();
    expect(wrap.find(".wp-filter-count").exists()).toBe(true);
    expect(wrap.find(".wp-filter-count").text()).toBe("4");
  });

  it("'No matches' empty state shows when filters active and result empty", async () => {
    const { wrap } = mountView({
      items: [],
      filter: { q: "nothing matches" },
    });
    await flushPromises();
    expect(wrap.text()).toContain("No matches");
    expect(wrap.text()).not.toContain("No things yet.");
  });

  it("clear-all button removes filter chips", async () => {
    const { wrap, filter } = mountView({
      items: makeItems(3),
      filter: { favorites: true, tags: ["a"], category: "cat-1" },
    });
    await flushPromises();
    expect(wrap.findAll(".filter-chip").length).toBeGreaterThan(0);
    const clearBtn = wrap.findAll("button").find((b) => b.text() === "Clear all");
    expect(clearBtn).toBeDefined();
    if (!clearBtn) throw new Error("missing clear button");
    await clearBtn.trigger("click");
    await flushPromises();
    expect(filter.favorites).toBe(false);
    expect(filter.category).toBeUndefined();
    expect(filter.tags).toEqual([]);
    expect(wrap.findAll(".filter-chip").length).toBe(0);
  });

  it("removing a tag chip removes only that tag", async () => {
    const { wrap, filter } = mountView({
      items: makeItems(3),
      filter: { tags: ["a", "b"] },
    });
    await flushPromises();
    const tagChips = wrap.findAll(".filter-chip--tag");
    expect(tagChips.length).toBe(2);
    // Click the close button of the first tag chip.
    await tagChips[0].find(".filter-chip__close").trigger("click");
    await flushPromises();
    expect(filter.tags).toEqual(["b"]);
    expect(wrap.findAll(".filter-chip--tag").length).toBe(1);
  });

  it("renders extraFilters as toggle chips inside the filter panel", async () => {
    const { wrap } = mountView({
      items: makeItems(4),
      extraFilters: [
        { key: "fav", label: "Favorited", check: (r: Row) => !!r.is_favorite },
      ],
    });
    await flushPromises();
    // Open the filter panel.
    const filtersBtn = wrap.findAll("button").find((b) => b.text().includes("Filters"));
    expect(filtersBtn).toBeDefined();
    if (!filtersBtn) throw new Error("missing filters button");
    await filtersBtn.trigger("click");
    await flushPromises();
    expect(wrap.find(".wp-extra-chip").exists()).toBe(true);
    expect(wrap.find(".wp-extra-chip").text()).toContain("Favorited");
    // Count badge reflects matches in items (1 of 4 favorited).
    expect(wrap.find(".wp-extra-chip__count").text()).toBe("1");
  });
});
