import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import ModuleListView from "../../components/ModuleListView.vue";

async function mountList(props: Record<string, unknown>) {
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
      items: [],
      filter: {},
      emptyMessage: "Empty",
      ...props,
    },
    attachTo: document.body,
  });
}

beforeEach(() => setActivePinia(createPinia()));

describe("ModuleListView skeleton rows", () => {
  it("renders skeleton rows when loading and items empty", async () => {
    const wrapper = await mountList({ items: [], loading: true });
    expect(wrapper.findAll(".wp-row-skel").length).toBe(6);
    expect(wrapper.findAll(".wp-skel-bar").length).toBeGreaterThan(0);
    // Empty state should NOT render while skeleton is up.
    expect(wrapper.find(".wp-empty").exists()).toBe(false);
  });

  it("does not render skeleton when items present (even if loading)", async () => {
    const items = [{ id: "x", name: "X", tags: [], updated_at: "2026-01-01T00:00:00Z" }];
    const wrapper = await mountList({ items, loading: true });
    expect(wrapper.findAll(".wp-row-skel").length).toBe(0);
  });

  it("does not render skeleton when not loading and items empty (shows empty state)", async () => {
    const wrapper = await mountList({ items: [], loading: false });
    expect(wrapper.findAll(".wp-row-skel").length).toBe(0);
    // Empty state should render.
    expect(wrapper.find(".wp-empty").exists()).toBe(true);
  });
});
