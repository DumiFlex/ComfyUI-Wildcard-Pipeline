import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import InternalFlagSection from "./InternalFlagSection.vue";

describe("InternalFlagSection", () => {
  it("reflects library value when modelValue is null (no override)", () => {
    const wrapper = renderSection(InternalFlagSection, {
      library: true, modelValue: null,
    });
    const cb = wrapper.find('input[data-test="if-toggle"]');
    expect((cb.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="if-reset"]').exists()).toBe(false);
  });

  it("reflects override value when modelValue is non-null", () => {
    const wrapper = renderSection(InternalFlagSection, {
      library: false, modelValue: true,
    });
    const cb = wrapper.find('input[data-test="if-toggle"]');
    expect((cb.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="if-reset"]').exists()).toBe(true);
  });

  it("emits update:modelValue with the toggled value when checked", async () => {
    const wrapper = renderSection(InternalFlagSection, {
      library: false, modelValue: null,
    });
    const cb = wrapper.find('input[data-test="if-toggle"]');
    (cb.element as HTMLInputElement).checked = true;
    await cb.trigger("change");
    expect(getEmittedUpdate<boolean | null>(wrapper)).toBe(true);
  });

  it("emits update:modelValue with the new value when toggled off", async () => {
    const wrapper = renderSection(InternalFlagSection, {
      library: false, modelValue: true,
    });
    const cb = wrapper.find('input[data-test="if-toggle"]');
    (cb.element as HTMLInputElement).checked = false;
    await cb.trigger("change");
    expect(getEmittedUpdate<boolean | null>(wrapper)).toBe(false);
  });

  it("emits reset event on reset-button click when override is set", async () => {
    const wrapper = renderSection(InternalFlagSection, {
      library: false, modelValue: true,
    });
    await wrapper.find('[data-test="if-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });

  it("shows modified marker only when modelValue is non-null", () => {
    const w1 = renderSection(InternalFlagSection, { library: true, modelValue: null });
    expect(w1.find('.wp-instance-section-modified').exists()).toBe(false);
    const w2 = renderSection(InternalFlagSection, { library: true, modelValue: false });
    expect(w2.find('.wp-instance-section-modified').exists()).toBe(true);
  });
});
