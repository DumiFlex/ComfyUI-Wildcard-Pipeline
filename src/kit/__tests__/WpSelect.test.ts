import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WpSelect from "../WpSelect.vue";

const OPTS = [{ value: 1, label: "One" }, { value: 2, label: "Two" }];

describe("WpSelect", () => {
  it("shows the chosen option and emits the option's own value", async () => {
    const w = mount(WpSelect, { props: { modelValue: 2, options: OPTS, dataTest: "s" } });
    const sel = w.get<HTMLSelectElement>('[data-test="s"]');
    expect(sel.element.selectedIndex).toBe(1);
    await sel.setValue("1");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([1]);
  });

  it("a placeholder menu goes back to its placeholder after a pick", async () => {
    const w = mount(WpSelect, {
      props: { modelValue: null, options: OPTS, placeholder: "+ Add…", dataTest: "s" },
    });
    const sel = w.get<HTMLSelectElement>('[data-test="s"]');
    expect(sel.element.selectedIndex).toBe(0);
    await sel.setValue("2");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([2]);
    await w.vm.$nextTick();
    expect(sel.element.selectedIndex).toBe(0);
  });
});
