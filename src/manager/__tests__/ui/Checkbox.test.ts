import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Checkbox from "../../components/ui/Checkbox.vue";

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
});
