import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import StaleBanner from "../StaleBanner.vue";
import { useStaleStore } from "../../stores/staleStore";

describe("StaleBanner", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("renders nothing when not stale", () => {
    const wrapper = mount(StaleBanner);
    expect(wrapper.find("[data-test='stale-banner']").exists()).toBe(false);
  });

  it("renders banner when stale", async () => {
    const wrapper = mount(StaleBanner);
    const store = useStaleStore();
    store.markStale();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='stale-banner']").exists()).toBe(true);
    expect(wrapper.text()).toContain("restarted");
  });

  it("Reload button triggers store.reload", async () => {
    const wrapper = mount(StaleBanner);
    const store = useStaleStore();
    store.markStale();
    await wrapper.vm.$nextTick();
    const spy = vi.spyOn(store, "reload").mockImplementation(() => undefined);
    await wrapper.find("[data-test='stale-reload']").trigger("click");
    expect(spy).toHaveBeenCalled();
  });
});
