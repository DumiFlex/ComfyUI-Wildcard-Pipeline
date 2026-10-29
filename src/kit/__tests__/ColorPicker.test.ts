import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ColorPicker from "../ColorPicker.vue";

function makeWrapper(modelValue = "#7c3aed") {
  return mount(ColorPicker, {
    props: { modelValue },
    global: { plugins: [], stubs: { Teleport: true } },
  });
}

async function openPopover(wrapper: ReturnType<typeof makeWrapper>) {
  await wrapper.get('[data-test="color-swatch"]').trigger("click");
}

describe("ColorPicker.vue", () => {
  it("renders the swatch with the bound color", () => {
    const wrap = makeWrapper("#ff0000");
    const swatch = wrap.get('[data-test="color-swatch"]');
    const style = swatch.attributes("style") ?? "";
    // jsdom normalizes hex to rgb(...) in style strings.
    expect(style.toLowerCase()).toMatch(/rgb\(255,\s*0,\s*0\)|#ff0000/);
  });

  it("clicking a preset emits update:modelValue with that hex", async () => {
    const wrap = makeWrapper("#000000");
    await openPopover(wrap);
    const presets = wrap.findAll('[data-test="color-preset"]');
    expect(presets.length).toBe(12);
    await presets[0].trigger("click");
    const events = wrap.emitted("update:modelValue");
    expect(events).toBeTruthy();
    // First default preset is "#7c3aed".
    expect(events?.[0]).toEqual(["#7c3aed"]);
  });

  it("invalid hex input does NOT emit update:modelValue", async () => {
    const wrap = makeWrapper("#000000");
    await openPopover(wrap);
    const hexInput = wrap.get('[data-test="color-hex-input"]');
    await hexInput.setValue("abc");
    expect(wrap.emitted("update:modelValue")).toBeFalsy();
  });

  it("valid hex input emits update:modelValue with that hex", async () => {
    const wrap = makeWrapper("#000000");
    await openPopover(wrap);
    const hexInput = wrap.get('[data-test="color-hex-input"]');
    await hexInput.setValue("#ff0000");
    const events = wrap.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events?.[events!.length - 1]).toEqual(["#ff0000"]);
  });

  it("uses provided ariaLabel on the swatch button", () => {
    const wrap = mount(ColorPicker, {
      props: { modelValue: "#abcdef", ariaLabel: "Pick brand color" },
      global: { plugins: [], stubs: { Teleport: true } },
    });
    expect(wrap.get('[data-test="color-trigger"]').attributes("aria-label"))
      .toBe("Pick brand color");
  });

  it("shows the hex next to the swatch in the closed picker", () => {
    const wrap = makeWrapper("#A78BFA");
    expect(wrap.get('[data-test="color-trigger"]').text()).toContain("#a78bfa");
  });

  it("supports custom presets prop", async () => {
    const wrap = mount(ColorPicker, {
      props: { modelValue: "#000000", presets: ["#111111", "#222222"] },
      global: { plugins: [], stubs: { Teleport: true } },
    });
    await openPopover(wrap);
    expect(wrap.findAll('[data-test="color-preset"]').length).toBe(2);
  });

});
