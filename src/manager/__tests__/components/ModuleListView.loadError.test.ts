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

describe("ModuleListView load-error banner", () => {
  it("does not render the banner when loadError is null", async () => {
    const wrapper = await mountList({ loadError: null });
    expect(wrapper.find('[data-test="load-error-banner"]').exists()).toBe(false);
  });

  it("renders the banner when loadError is non-empty", async () => {
    const wrapper = await mountList({ loadError: "Network refused connection" });
    const banner = wrapper.find('[data-test="load-error-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Couldn't load");
    expect(banner.text()).toContain("Network refused connection");
  });

  it("emits fetch when retry button is clicked", async () => {
    const wrapper = await mountList({ loadError: "boom" });
    await wrapper.find('[data-test="load-error-retry"]').trigger("click");
    expect(wrapper.emitted("fetch")).toBeTruthy();
  });
});
