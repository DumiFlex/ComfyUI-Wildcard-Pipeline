import { describe, expect, it, beforeEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import ModuleListView from "../../components/ModuleListView.vue";

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Row ${i}`,
    is_favorite: false,
    tags: [],
    updated_at: "2026-01-01T00:00:00Z",
    category_id: null,
  }));
}

async function mountList(items: ReturnType<typeof rows>, pageSize = 10): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/:p+", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  return mount(ModuleListView, {
    global: { plugins: [router] },
    props: {
      title: "T",
      subtitle: "",
      newLabel: "+",
      newRoute: "/n",
      items,
      filter: {},
      emptyMessage: "Empty",
      pageSize,
    },
    attachTo: document.body,
  }) as unknown as VueWrapper;
}

beforeEach(() => setActivePinia(createPinia()));

describe("ModuleListView selection across pages", () => {
  it("retains off-page selections after paging", async () => {
    const wrapper = await mountList(rows(20), 10);

    // Select first row on page 1.
    await wrapper.find('[data-test="row-select-r0"]').trigger("click");
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(true);

    // Navigate to page 2 via the exposed goToPage.
    (wrapper.vm as unknown as { goToPage: (p: number) => void }).goToPage(2);
    await wrapper.vm.$nextTick();

    // Bulk bar still present (selection survives the page change).
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(true);
    // Hint reads "1 elsewhere" since the selected row is on page 1, not the current page 2.
    expect(wrapper.text()).toContain("1 elsewhere");
  });

  it("Select all matching button selects everything in filteredItems", async () => {
    const wrapper = await mountList(rows(20), 10);

    // Open bulk bar by selecting first row.
    await wrapper.find('[data-test="row-select-r0"]').trigger("click");

    // "Select all matching" button is present (filteredItems.length > paged.length and not all selected).
    expect(wrapper.find('[data-test="bulk-select-all-matching"]').exists()).toBe(true);

    await wrapper.find('[data-test="bulk-select-all-matching"]').trigger("click");
    await wrapper.vm.$nextTick();

    // All 20 selected; bulk-bar count reads "20".
    expect(wrapper.text()).toMatch(/\b20\b.*selected/);
  });

  it("Select all matching button hidden when all visible items already selected and no off-page items", async () => {
    const wrapper = await mountList(rows(5), 10);

    // Select first row.
    await wrapper.find('[data-test="row-select-r0"]').trigger("click");
    // Only 5 rows total, pageSize 10 — all visible. canSelectAllMatching false.
    expect(wrapper.find('[data-test="bulk-select-all-matching"]').exists()).toBe(false);
  });
});
