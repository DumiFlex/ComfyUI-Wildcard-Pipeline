import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Checkbox from "../Checkbox.vue";

describe("Checkbox.vue", () => {
  it("toggles modelValue when clicked", async () => {
    const wrap = mount(Checkbox, { props: { modelValue: false, label: "Enable" } });
    await wrap.get("button.wp-check").trigger("click");
    expect(wrap.emitted("update:modelValue")?.[0]).toEqual([true]);
  });

  it("does not toggle when disabled", async () => {
    const wrap = mount(Checkbox, { props: { modelValue: false, disabled: true } });
    await wrap.get("button.wp-check").trigger("click");
    expect(wrap.emitted("update:modelValue")).toBeFalsy();
  });

  it("reflects error state via aria-invalid on the check button", () => {
    const wrap = mount(Checkbox, { props: { modelValue: false, error: true } });
    expect(wrap.get("button.wp-check").attributes("aria-invalid")).toBe("true");
  });

  it("renders indeterminate state with aria-checked=mixed when unchecked + indeterminate", () => {
    const wrap = mount(Checkbox, { props: { modelValue: false, indeterminate: true } });
    const btn = wrap.get("button.wp-check");
    expect(btn.attributes("aria-checked")).toBe("mixed");
    expect(btn.attributes("data-indeterminate")).toBe("true");
    // Dash svg renders only in the indeterminate-and-unchecked branch.
    expect(wrap.find("svg").exists()).toBe(true);
  });

  it("ignores indeterminate when modelValue is true (checked wins)", () => {
    const wrap = mount(Checkbox, { props: { modelValue: true, indeterminate: true } });
    const btn = wrap.get("button.wp-check");
    expect(btn.attributes("aria-checked")).toBe("true");
    expect(btn.attributes("data-indeterminate")).toBe("false");
  });

  // The TUI look hides the drawn tick (`.wp-check svg { display: none }`) and
  // writes [x]; an inline display on the tick beat that rule and drew both.
  it("puts no inline style on the tick or the dash", () => {
    for (const props of [{ modelValue: true, indeterminate: false }, { modelValue: false, indeterminate: true }]) {
      const wrap = mount(Checkbox, { props });
      expect(wrap.get("svg").attributes("style")).toBeUndefined();
    }
  });

  it("draws a field box whose label toggles once", async () => {
    const wrap = mount(Checkbox, { props: { modelValue: false, label: "Favorites only", field: true } });
    expect(wrap.get(".wp-checkbox").classes()).toContain("wp-checkbox--field");
    await wrap.get(".wp-checkbox__label").trigger("click");
    expect(wrap.emitted("update:modelValue")).toEqual([[true]]);
  });
});
