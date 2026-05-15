import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HsvPicker from "../components/HsvPicker.vue";

describe("HsvPicker.vue", () => {
  it("renders SV square + hue strip", () => {
    const wrap = mount(HsvPicker, { props: { modelValue: "#7c3aed" } });
    expect(wrap.find('[data-test="hsv-sv"]').exists()).toBe(true);
    expect(wrap.find('[data-test="hsv-hue"]').exists()).toBe(true);
  });

  it("sets the hue background from the current modelValue", () => {
    const wrap = mount(HsvPicker, { props: { modelValue: "#ff0000" } });
    const sv = wrap.get('[data-test="hsv-sv"]');
    const style = sv.attributes("style") ?? "";
    // jsdom serializes CSS custom-properties — assert the hue background
    // var is present and references a hsl() expression.
    expect(style.toLowerCase()).toContain("hsl(");
  });

  it("preserves hue when modelValue switches to a grayscale color", async () => {
    const wrap = mount(HsvPicker, { props: { modelValue: "#ff0000" } });
    await wrap.setProps({ modelValue: "#000000" });
    // After receiving black (s=0), the local hue ref should still
    // produce a colorful SV background — assert via the inline style.
    const sv = wrap.get('[data-test="hsv-sv"]');
    const style = sv.attributes("style") ?? "";
    // The cached hue from #ff0000 is 0, so we expect hsl(0, ...).
    expect(style).toMatch(/hsl\(\s*0/);
  });
});
