import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Toggle from "../Toggle.vue";

describe("Toggle.vue", () => {
  it("toggles modelValue", async () => {
    const wrap = mount(Toggle, { props: { modelValue: true } });
    await wrap.get('[role="switch"]').trigger("click");
    expect(wrap.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("wears the shared switch at the manager size", () => {
    const wrap = mount(Toggle, { props: { modelValue: true } });
    const sw = wrap.get('[role="switch"]');
    expect(sw.attributes("aria-checked")).toBe("true");
    expect(sw.classes()).toContain("wp-switch--md");
  });

  it("reflects the invalid state (and the old error prop) via aria-invalid", () => {
    expect(mount(Toggle, { props: { modelValue: false, invalid: true } }).get('[role="switch"]').attributes("aria-invalid")).toBe("true");
    expect(mount(Toggle, { props: { modelValue: false, error: true } }).get('[role="switch"]').attributes("aria-invalid")).toBe("true");
  });

  it("does not flip when disabled", async () => {
    const wrap = mount(Toggle, { props: { modelValue: false, disabled: true } });
    await wrap.get('[role="switch"]').trigger("click");
    expect(wrap.emitted("update:modelValue")).toBeUndefined();
  });
});
