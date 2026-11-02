import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { COLOUR_PRESETS, DEFAULT_COLOUR } from "../colour-presets";
import ColorPicker from "../ColorPicker.vue";

describe("colour presets", () => {
  it("are twelve hex colours and include the default", () => {
    expect(COLOUR_PRESETS).toHaveLength(12);
    expect(COLOUR_PRESETS.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    expect(COLOUR_PRESETS).toContain(DEFAULT_COLOUR);
  });

  it("are what ColorPicker offers by default", () => {
    const w = mount(ColorPicker, { props: { modelValue: DEFAULT_COLOUR } });
    expect((w.props("presets") as string[])).toEqual([...COLOUR_PRESETS]);
  });
});
