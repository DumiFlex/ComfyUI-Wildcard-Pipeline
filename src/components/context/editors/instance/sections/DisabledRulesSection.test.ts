import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import DisabledRulesSection from "./DisabledRulesSection.vue";

interface Rule { id: string; label?: string }
const lib: Rule[] = [
  { id: "r1", label: "Rule one" },
  { id: "r2", label: "Rule two" },
  { id: "r3", label: "Rule three" },
];

describe("DisabledRulesSection", () => {
  it("renders all rules enabled when modelValue is null", () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: null,
    });
    const checks = wrapper.findAll('[data-test^="dr-cb-"]');
    expect(checks).toHaveLength(3);
    checks.forEach((c) => {
      expect(c.attributes("aria-checked")).toBe("false");
    });
    expect(wrapper.find('[data-test="dr-reset"]').exists()).toBe(false);
  });

  it("renders disabled state when modelValue is non-null", () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: ["r1", "r3"],
    });
    expect(wrapper.find('[data-test="dr-cb-r1"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.find('[data-test="dr-cb-r2"]').attributes("aria-checked")).toBe("false");
    expect(wrapper.find('[data-test="dr-cb-r3"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.find('[data-test="dr-reset"]').exists()).toBe(true);
  });

  it("checking a row when null builds fresh array", async () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: null,
    });
    const cb = wrapper.find('[data-test="dr-cb-r2"]');
    await cb.trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual(["r2"]);
  });

  it("checking another row appends to existing array", async () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: ["r1"],
    });
    const cb = wrapper.find('[data-test="dr-cb-r3"]');
    await cb.trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toContain("r1");
    expect(next).toContain("r3");
    expect(next).toHaveLength(2);
  });

  it("unchecking a row removes from array; emits null when last is removed", async () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: ["r1"],
    });
    const cb = wrapper.find('[data-test="dr-cb-r1"]');
    await cb.trigger("click");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toBeNull();
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = renderSection(DisabledRulesSection, {
      library: lib, modelValue: ["r1"],
    });
    await wrapper.find('[data-test="dr-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
