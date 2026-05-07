import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import EnabledOptionsSection from "./EnabledOptionsSection.vue";

const lib = [
  { id: "o1", value: "red" },
  { id: "o2", value: "blue" },
  { id: "o3", value: "green" },
];

describe("EnabledOptionsSection", () => {
  it("checks all rows when modelValue is null (library default)", () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: null,
    });
    const checks = wrapper.findAll('input[data-test^="eo-cb-"]');
    expect(checks).toHaveLength(3);
    checks.forEach((c) => {
      expect((c.element as HTMLInputElement).checked).toBe(true);
    });
    expect(wrapper.find('[data-test="eo-reset"]').exists()).toBe(false);
  });

  it("checks only override-listed rows when modelValue is non-null", () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: ["o1", "o3"],
    });
    expect((wrapper.find('input[data-test="eo-cb-o1"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.find('input[data-test="eo-cb-o2"]').element as HTMLInputElement).checked).toBe(false);
    expect((wrapper.find('input[data-test="eo-cb-o3"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="eo-reset"]').exists()).toBe(true);
  });

  it("toggling off when null builds fresh array of all-but-this-id", async () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: null,
    });
    const cb = wrapper.find('input[data-test="eo-cb-o2"]');
    (cb.element as HTMLInputElement).checked = false;
    await cb.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual(["o1", "o3"]);
  });

  it("toggling off an enabled option removes it from the array", async () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: ["o1", "o2", "o3"],
    });
    const cb = wrapper.find('input[data-test="eo-cb-o1"]');
    (cb.element as HTMLInputElement).checked = false;
    await cb.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual(["o2", "o3"]);
  });

  it("toggling on a disabled option adds it back to the array", async () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: ["o1"],
    });
    const cb = wrapper.find('input[data-test="eo-cb-o3"]');
    (cb.element as HTMLInputElement).checked = true;
    await cb.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toContain("o1");
    expect(next).toContain("o3");
    expect(next).toHaveLength(2);
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = renderSection(EnabledOptionsSection, {
      library: lib, modelValue: ["o1"],
    });
    await wrapper.find('[data-test="eo-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
