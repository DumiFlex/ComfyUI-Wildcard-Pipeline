import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import OptionWeightsSection from "./OptionWeightsSection.vue";

const lib = [
  { id: "o1", value: "red", weight: 1 },
  { id: "o2", value: "blue", weight: 2 },
  { id: "o3", value: "green", weight: 3 },
];

describe("OptionWeightsSection", () => {
  it("shows library weights as placeholders when modelValue is null", () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: null,
    });
    const inp = wrapper.find('input[data-test="ow-input-o1"]');
    expect(inp.attributes("placeholder")).toBe("1");
    expect((inp.element as HTMLInputElement).value).toBe("");
    expect(wrapper.find('[data-test="ow-reset"]').exists()).toBe(false);
  });

  it("shows override weight when present in map", () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: { o1: 5 },
    });
    const inp = wrapper.find('input[data-test="ow-input-o1"]');
    expect((inp.element as HTMLInputElement).value).toBe("5");
    expect(wrapper.find('[data-test="ow-reset"]').exists()).toBe(true);
  });

  it("emits update:modelValue with new map entry when typing", async () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: null,
    });
    const inp = wrapper.find('input[data-test="ow-input-o2"]');
    (inp.element as HTMLInputElement).value = "7";
    await inp.trigger("input");
    const next = getEmittedUpdate<Record<string, number> | null>(wrapper);
    expect(next).toEqual({ o2: 7 });
  });

  it("clears single map entry when input is emptied", async () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: { o1: 5, o2: 10 },
    });
    const inp = wrapper.find('input[data-test="ow-input-o1"]');
    (inp.element as HTMLInputElement).value = "";
    await inp.trigger("input");
    const next = getEmittedUpdate<Record<string, number> | null>(wrapper);
    expect(next).toEqual({ o2: 10 });
  });

  it("emits null when last map entry is cleared", async () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: { o1: 5 },
    });
    const inp = wrapper.find('input[data-test="ow-input-o1"]');
    (inp.element as HTMLInputElement).value = "";
    await inp.trigger("input");
    const next = getEmittedUpdate<Record<string, number> | null>(wrapper);
    expect(next).toBeNull();
  });

  it("per-row reset button clears single entry", async () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: { o1: 5, o2: 10 },
    });
    await wrapper.find('[data-test="ow-row-reset-o2"]').trigger("click");
    const next = getEmittedUpdate<Record<string, number> | null>(wrapper);
    expect(next).toEqual({ o1: 5 });
  });

  it("emits reset event on full reset-button click", async () => {
    const wrapper = renderSection(OptionWeightsSection, {
      library: lib, modelValue: { o1: 5 },
    });
    await wrapper.find('[data-test="ow-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
