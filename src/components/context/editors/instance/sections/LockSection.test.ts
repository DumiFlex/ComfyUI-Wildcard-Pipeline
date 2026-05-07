import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LockSection from "./LockSection.vue";

function mountSection(props: {
  modelValue: number | null;
  lastLockedSeed?: number;
}) {
  return mount(LockSection, {
    props: { library: undefined, ...props },
  });
}

describe("LockSection", () => {
  it("renders unlocked + no seed input when modelValue is null", () => {
    const wrapper = mountSection({ modelValue: null });
    const toggle = wrapper.find('input[data-test="lk-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find('input[data-test="lk-seed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lk-reset"]').exists()).toBe(false);
  });

  it("renders locked + seed input when modelValue is non-null", () => {
    const wrapper = mountSection({ modelValue: 42 });
    const toggle = wrapper.find('input[data-test="lk-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
    const seed = wrapper.find('input[data-test="lk-seed"]');
    expect((seed.element as HTMLInputElement).value).toBe("42");
    expect(wrapper.find('[data-test="lk-reset"]').exists()).toBe(true);
  });

  it("toggling on uses lastLockedSeed when provided", async () => {
    const wrapper = mountSection({ modelValue: null, lastLockedSeed: 99 });
    const toggle = wrapper.find('input[data-test="lk-toggle"]');
    (toggle.element as HTMLInputElement).checked = true;
    await toggle.trigger("change");
    const events = wrapper.emitted("update:modelValue");
    expect(events?.[0]?.[0]).toBe(99);
  });

  it("toggling on without lastLockedSeed emits a numeric seed and update:lastLockedSeed", async () => {
    const wrapper = mountSection({ modelValue: null });
    const toggle = wrapper.find('input[data-test="lk-toggle"]');
    (toggle.element as HTMLInputElement).checked = true;
    await toggle.trigger("change");
    const evMv = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(typeof evMv).toBe("number");
    const evLast = wrapper.emitted("update:lastLockedSeed")?.[0]?.[0];
    expect(typeof evLast).toBe("number");
    expect(evLast).toBe(evMv);
  });

  it("toggling off emits null modelValue but does NOT touch lastLockedSeed", async () => {
    const wrapper = mountSection({ modelValue: 42, lastLockedSeed: 42 });
    const toggle = wrapper.find('input[data-test="lk-toggle"]');
    (toggle.element as HTMLInputElement).checked = false;
    await toggle.trigger("change");
    const evMv = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(evMv).toBeNull();
    expect(wrapper.emitted("update:lastLockedSeed")).toBeUndefined();
  });

  it("editing seed input emits update:modelValue with the new number AND update:lastLockedSeed", async () => {
    const wrapper = mountSection({ modelValue: 42, lastLockedSeed: 42 });
    const seed = wrapper.find('input[data-test="lk-seed"]');
    (seed.element as HTMLInputElement).value = "777";
    await seed.trigger("input");
    const evMv = wrapper.emitted("update:modelValue")?.[0]?.[0];
    const evLast = wrapper.emitted("update:lastLockedSeed")?.[0]?.[0];
    expect(evMv).toBe(777);
    expect(evLast).toBe(777);
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = mountSection({ modelValue: 42 });
    await wrapper.find('[data-test="lk-reset"]').trigger("click");
    expect(wrapper.emitted("reset")?.length).toBe(1);
  });
});
