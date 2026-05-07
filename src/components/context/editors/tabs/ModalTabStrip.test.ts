import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModalTabStrip from "./ModalTabStrip.vue";

describe("ModalTabStrip", () => {
  it("renders both tabs when hasInstanceTab=true", () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "library", hasInstanceTab: true, instanceModified: false },
    });
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(true);
  });

  it("hides Instance tab when hasInstanceTab=false", () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "library", hasInstanceTab: false, instanceModified: false },
    });
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("renders orange dot on Instance tab when instanceModified=true", () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "library", hasInstanceTab: true, instanceModified: true },
    });
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(true);
  });

  it("does NOT render orange dot when instanceModified=false", () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "library", hasInstanceTab: true, instanceModified: false },
    });
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(false);
  });

  it("emits update:modelValue when a tab is clicked", async () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "library", hasInstanceTab: true, instanceModified: false },
    });
    await wrapper.find('[data-test="tab-instance"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["instance"]);
  });

  it("marks active tab via aria-selected + class", () => {
    const wrapper = mount(ModalTabStrip, {
      props: { modelValue: "instance", hasInstanceTab: true, instanceModified: false },
    });
    expect(wrapper.find('[data-test="tab-instance"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-test="tab-library"]').attributes("aria-selected")).toBe("false");
  });
});
