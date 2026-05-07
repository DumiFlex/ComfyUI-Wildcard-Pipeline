import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import CategoryFilterSection from "./CategoryFilterSection.vue";

const lib = ["primary", "secondary", "rare"];

describe("CategoryFilterSection", () => {
  it("renders all chips highlighted when modelValue is null (library default)", () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: null,
    });
    const chips = wrapper.findAll('[data-test^="cf-chip-"]');
    expect(chips).toHaveLength(3);
    chips.forEach((chip) => {
      expect(chip.classes()).toContain("is-active");
    });
    expect(wrapper.find('[data-test="cf-reset"]').exists()).toBe(false);
  });

  it("renders only override-listed chips active when modelValue is non-null", () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: ["primary"],
    });
    expect(wrapper.find('[data-test="cf-chip-primary"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-test="cf-chip-secondary"]').classes()).not.toContain("is-active");
    expect(wrapper.find('[data-test="cf-reset"]').exists()).toBe(true);
  });

  it("clicking a chip when null builds fresh exclusion array", async () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: null,
    });
    await wrapper.find('[data-test="cf-chip-secondary"]').trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual(["primary", "rare"]);
  });

  it("clicking an active chip removes it from override list", async () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: ["primary", "secondary"],
    });
    await wrapper.find('[data-test="cf-chip-primary"]').trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual(["secondary"]);
  });

  it("clicking an inactive chip adds it back to override list", async () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: ["primary"],
    });
    await wrapper.find('[data-test="cf-chip-rare"]').trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toContain("primary");
    expect(next).toContain("rare");
    expect(next).toHaveLength(2);
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = renderSection(CategoryFilterSection, {
      library: lib, modelValue: ["primary"],
    });
    await wrapper.find('[data-test="cf-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
