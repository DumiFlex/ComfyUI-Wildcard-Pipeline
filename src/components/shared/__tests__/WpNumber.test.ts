import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WpNumber from "../WpNumber.vue";

function last(w: ReturnType<typeof mount>): unknown {
  const e = w.emitted("update:modelValue");
  return e?.[e.length - 1]?.[0];
}

describe("WpNumber", () => {
  it("steps with the arrows and clamps to min / max", async () => {
    const w = mount(WpNumber, { props: { modelValue: 9, min: 0, max: 10, dataTest: "n" } });
    await w.get('[data-test="n-up"]').trigger("click");
    expect(last(w)).toBe(10);
    await w.setProps({ modelValue: 10 });
    await w.get('[data-test="n-up"]').trigger("click");
    expect(last(w)).toBe(10);
    await w.setProps({ modelValue: 0 });
    await w.get('[data-test="n-down"]').trigger("click");
    expect(last(w)).toBe(0);
  });

  it("keeps the step's decimals and steps from the keyboard", async () => {
    const w = mount(WpNumber, { props: { modelValue: 1, step: 0.1, dataTest: "n" } });
    await w.get('[data-test="n"]').trigger("keydown", { key: "ArrowUp" });
    expect(last(w)).toBe(1.1);
    await w.get('[data-test="n"]').trigger("keydown", { key: "ArrowDown" });
    expect(last(w)).toBe(0.9);
  });

  it("commits typed numbers on change, or on input when asked, and skips blanks", async () => {
    const w = mount(WpNumber, { props: { modelValue: 1, dataTest: "n" } });
    const input = w.get<HTMLInputElement>('[data-test="n"]');
    input.element.value = "7";
    await input.trigger("input");
    expect(w.emitted("update:modelValue")).toBeUndefined();
    await input.trigger("change");
    expect(last(w)).toBe(7);
    const live = mount(WpNumber, { props: { modelValue: 1, commit: "input", dataTest: "n" } });
    await live.get('[data-test="n"]').setValue("");
    expect(live.emitted("update:modelValue")).toBeUndefined();
    await live.get('[data-test="n"]').setValue("42");
    expect(last(live)).toBe(42);
  });

  it("does nothing while disabled", async () => {
    const w = mount(WpNumber, { props: { modelValue: 1, disabled: true, dataTest: "n" } });
    await w.get('[data-test="n-up"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });
});
