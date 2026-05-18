import { describe, expect, it, beforeEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import ModuleListView from "../../components/ModuleListView.vue";

interface Row {
  id: string;
  name: string;
  is_favorite: boolean;
  tags: string[];
  updated_at: string;
  category_id: string | null;
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: over.id ?? "r1",
    name: over.name ?? "Row",
    is_favorite: over.is_favorite ?? false,
    tags: over.tags ?? [],
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
    category_id: over.category_id ?? null,
  };
}

async function mountList(rows: Row[]): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/:p+", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(ModuleListView, {
    global: { plugins: [router] },
    attachTo: document.body,
    props: {
      title: "Test",
      subtitle: "",
      newLabel: "+ New",
      newRoute: "/new",
      items: rows,
      filter: {},
      emptyMessage: "Empty",
      availableTags: ["red", "blue"],
      categoryOptions: [
        { value: null, label: "(none)" },
        { value: "c1", label: "Cat 1" },
      ],
    },
  }) as unknown as VueWrapper;
  return { wrapper, router };
}

beforeEach(() => setActivePinia(createPinia()));

describe("ModuleListView bulk-bar", () => {
  it("renders bulk bar only when selection non-empty", async () => {
    const { wrapper } = await mountList([row({ id: "a" })]);
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(false);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("emits bulk-favorite on Favorite click", async () => {
    const { wrapper } = await mountList([row({ id: "a", is_favorite: false })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-favorite-on"]').trigger("click");
    const ev = wrapper.emitted("bulk-favorite");
    expect(ev).toBeTruthy();
    expect((ev![0][0] as Row[])).toHaveLength(1);
    expect(ev![0][1]).toBe(true);
    wrapper.unmount();
  });

  it("emits bulk-favorite false on Unfavorite click", async () => {
    const { wrapper } = await mountList([row({ id: "a", is_favorite: true })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-favorite-off"]').trigger("click");
    expect(wrapper.emitted("bulk-favorite")![0][1]).toBe(false);
    wrapper.unmount();
  });

  it("emits bulk-duplicate", async () => {
    const { wrapper } = await mountList([row({ id: "a" })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-duplicate"]').trigger("click");
    expect(wrapper.emitted("bulk-duplicate")).toBeTruthy();
    wrapper.unmount();
  });

  it("opens tag-add modal and emits with submitted value", async () => {
    const { wrapper } = await mountList([row({ id: "a" })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-tag-add-open"]').trigger("click");
    await wrapper.vm.$nextTick();
    const input = document.body.querySelector('[data-test="bulk-tag-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "urgent";
    input!.dispatchEvent(new Event("input"));
    await wrapper.vm.$nextTick();
    const submit = document.body.querySelector('[data-test="bulk-tag-submit"]') as HTMLElement | null;
    expect(submit).not.toBeNull();
    submit!.click();
    await wrapper.vm.$nextTick();
    const ev = wrapper.emitted("bulk-tag-add");
    expect(ev).toBeTruthy();
    expect(ev![0][1]).toBe("urgent");
    wrapper.unmount();
  });

  it("emits bulk-delete after confirm", async () => {
    const { wrapper } = await mountList([row({ id: "a" })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-delete-open"]').trigger("click");
    await wrapper.vm.$nextTick();
    const confirm = document.body.querySelector('[data-test="bulk-delete-confirm"]') as HTMLElement | null;
    expect(confirm).not.toBeNull();
    confirm!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("bulk-delete")).toBeTruthy();
    wrapper.unmount();
  });

  it("Clear button empties selection", async () => {
    const { wrapper } = await mountList([row({ id: "a" })]);
    await wrapper.find('[data-test="row-select-a"]').trigger("click");
    await wrapper.find('[data-test="bulk-clear"]').trigger("click");
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
