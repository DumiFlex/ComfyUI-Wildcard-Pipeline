import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Select from "../../components/ui/Select.vue";

const opts = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("Select.vue", () => {
  it("opens menu on click and renders options", async () => {
    const wrap = mount(Select, { props: { modelValue: null, options: opts } });
    expect(wrap.find(".wp-select__menu").exists()).toBe(false);
    await wrap.get("[data-test='select-trigger']").trigger("click");
    expect(wrap.find(".wp-select__menu").exists()).toBe(true);
    expect(wrap.findAll(".wp-select__option").length).toBe(3);
  });

  it("Enter on highlighted option emits update:modelValue", async () => {
    const wrap = mount(Select, { props: { modelValue: null, options: opts } });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    // First option (index 0) is active by default.
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await trigger.trigger("keydown", { key: "Enter" });
    const events = wrap.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(["b"]);
  });

  it("Esc closes the menu", async () => {
    const wrap = mount(Select, { props: { modelValue: null, options: opts } });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    expect(wrap.find(".wp-select__menu").exists()).toBe(true);
    await trigger.trigger("keydown", { key: "Escape" });
    expect(wrap.find(".wp-select__menu").exists()).toBe(false);
  });
});
