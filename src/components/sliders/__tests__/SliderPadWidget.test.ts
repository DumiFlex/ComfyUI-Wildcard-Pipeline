import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SliderPadWidget from "../SliderPadWidget.vue";
import { mixPreset, orbitPreset, padConfig, type SliderRow, type SlidersConfig } from "../../../extension/sliders";

const cfg: SlidersConfig = padConfig({
  rows: [
    { id: "x", kind: "slider", name: "Width", var: "width", value: 1024, min: 512, max: 2048, step: 64, decimals: 0 },
    { id: "y", kind: "slider", name: "Mood", var: "mood", value: 0.8, mode: "words",
      words: [{ word: "calm", upto: 0.5 }, { word: "wild" }] },
  ],
});

function last(w: { emitted: (e: string) => unknown[][] | undefined }): SlidersConfig | undefined {
  const all = w.emitted("update:modelValue");
  return all?.[all.length - 1]?.[0] as SlidersConfig | undefined;
}
const rows = (c: SlidersConfig | undefined): SliderRow[] => (c?.rows ?? []) as SliderRow[];

describe("SliderPadWidget", () => {
  it("shows both axes and moves them from the pad's keys", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg } });
    expect(w.find('[data-test="pad-axis-0"]').text()).toContain("$width");
    expect(w.find('[data-test="pad-axis-1"]').text()).toContain("wild");
    const thumb = w.find('[role="slider"]');
    await thumb.trigger("keydown", { key: "ArrowRight" });
    expect(rows(last(w)).map((s) => s.value)).toEqual([1088, 0.8]);
    await thumb.trigger("keydown", { key: "ArrowDown" });
    expect(rows(last(w))[1]?.value).toBeCloseTo(0.79);
    w.unmount();
  });

  it("opens the edit strip from the toolbar pencil and sets the looks", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg, editRequest: 0 } });
    expect(w.find('[data-test="pad-looks"]').exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-shape-1.5"]').trigger("click");
    expect(last(w)?.pad).toEqual({ ratio: 1.5 });
    await w.find('[data-test="pad-swap"]').trigger("click");
    expect(rows(last(w)).map((s) => [s.var, s.out])).toEqual([["mood", 1], ["width", 2]]);
    w.unmount();
  });

  it("sets the style, Auto shape, size, dots and snap", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg, editRequest: 1 } });
    await w.setProps({ editRequest: 2 });
    await w.find('[data-test="pad-style-map"]').trigger("click");
    expect(last(w)?.pad).toEqual({ style: "map" });
    await w.setProps({ modelValue: last(w) });
    expect(w.findAll(".wp-xypad__band").map((b) => b.text())).toEqual(["calm", "wild"]);
    await w.find('[data-test="pad-shape-fit"]').trigger("click");
    expect(last(w)?.pad).toEqual({ style: "map", fit: true });
    await w.find('[data-test="pad-size-s"]').trigger("click");
    await w.find('[data-test="pad-snap-dots"]').trigger("click");
    expect(last(w)?.pad).toMatchObject({ snap_dots: true });
    expect(w.findAll(".wp-xypad__cell")).toHaveLength(2);
    await w.find('[data-test="pad-tint"]').trigger("click");
    expect(last(w)?.pad).toMatchObject({ no_tint: true });
    w.unmount();
  });

  it("puts a dot on every step by default", () => {
    const small = padConfig({ rows: [
      { id: "x", kind: "slider", name: "X", var: "x", value: 0.5, min: 0, max: 1, step: 0.25, decimals: 2 },
      { id: "y", kind: "slider", name: "Y", var: "y", value: 0.5, min: 0, max: 1, step: 0.5, decimals: 2 },
    ] });
    const w = mount(SliderPadWidget, { props: { modelValue: small } });
    expect(w.findAll(".wp-xypad__dot")).toHaveLength(3);
    w.unmount();
  });

  it("an axis window keeps its output and slot", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg }, attachTo: document.body });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-edit-1"]').trigger("click");
    for (let i = 0; i < 4; i++) {
      await vi.dynamicImportSettled();
      await flushPromises();
    }
    expect(document.body.querySelector('[data-test="sl-pin"]')).toBeNull();
    expect(document.body.textContent).toContain("Y axis");
    document.body.querySelector<HTMLElement>('[data-test="sl-out-type-float"]')?.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-test="sl-window-done"]')?.click();
    await flushPromises();
    expect(rows(last(w))[1]).toMatchObject({ var: "mood", pin: true, out: 2, out_type: "float" });
    w.unmount();
  });
  it("Match X copies X's range into Y's window", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg }, attachTo: document.body });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-edit-1"]').trigger("click");
    for (let i = 0; i < 4; i++) {
      await vi.dynamicImportSettled();
      await flushPromises();
    }
    expect(document.body.querySelector('[data-test="sl-match-Y"]')).toBeNull();
    document.body.querySelector<HTMLElement>('[data-test="sl-match-X"]')?.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-test="sl-window-done"]')?.click();
    await flushPromises();
    expect(rows(last(w))[1]).toMatchObject({ var: "mood", name: "Mood", min: 512, max: 2048, step: 64, decimals: 0, mode: "words", value: 512 });
    w.unmount();
  });

  it("swaps with X from Y's window, keeping each output", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: cfg }, attachTo: document.body });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-edit-1"]').trigger("click");
    for (let i = 0; i < 4; i++) {
      await vi.dynamicImportSettled();
      await flushPromises();
    }
    document.body.querySelector<HTMLElement>('[data-test="sl-swap-X"]')?.click();
    await flushPromises();
    expect(rows(last(w)).map((s) => [s.var, s.out])).toEqual([["mood", 1], ["width", 2]]);
    w.unmount();
  });

  it("Size fills untouched axes, and Stick has no Area", async () => {
    const fresh = mount(SliderPadWidget, { props: { modelValue: padConfig("", 2) } });
    await fresh.setProps({ editRequest: 1 });
    await fresh.find('[data-test="pad-style-size"]').trigger("click");
    expect(rows(last(fresh)).map((s) => s.var)).toEqual(["width", "height"]);
    expect(last(fresh)?.pad).toEqual({ style: "size", fit: true });
    await fresh.setProps({ modelValue: withStyle("stick") });
    expect(fresh.find('[data-test="pad-area"]').exists()).toBe(false);
    fresh.unmount();
  });
});

function withStyle(style: "stick"): SlidersConfig {
  return { ...padConfig("", 2), pad: { style } };
}

describe("SliderPadWidget, 3D", () => {
  const three = padConfig("", 3);

  it("shows three axes, sets Z from the fader and rings the point", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: three, dims: 3 } });
    expect(w.find('[data-test="pad-axis-2"]').text()).toContain("Z");
    expect(w.find(".wp-xypad__ring").exists()).toBe(true);
    const fader = w.find('[data-test="pad-z"] [role="slider"]');
    await fader.trigger("keydown", { key: "ArrowUp" });
    expect(rows(last(w)).map((s) => s.value)).toEqual([0.5, 0.5, 0.55]);
    w.unmount();
  });

  it("moves Z with the mouse wheel over the pad", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: three, dims: 3 } });
    const box = w.find('[data-test="pad"]').element.parentElement;
    box?.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    expect(rows(last(w))[2]?.value).toBeCloseTo(0.45);
    w.unmount();
  });

  it("turns to Orbit with the camera words, then the light words", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: three, dims: 3, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-style-orbit"]').trigger("click");
    const cam = last(w);
    expect(cam?.pad).toEqual({ style: "orbit" });
    expect(rows(cam).map((s) => s.var)).toEqual(["view_side", "view_height", "view_shot", "view"]);
    await w.setProps({ modelValue: cam });
    expect(w.find('[data-test="orbit"]').exists()).toBe(true);
    expect(w.find('[data-test="pad-phrase"]').text()).toContain("front-left view, high angle, medium shot");
    expect(w.find('[data-test="pad-swap"]').exists()).toBe(false);
    await w.find('[data-test="orbit-light"]').trigger("click");
    expect(last(w)?.pad).toEqual({ style: "orbit", light: true });
    await w.setProps({ modelValue: last(w) });
    expect(w.find(".wp-orbit").attributes("data-variant")).toBe("light");
    await w.find('[data-test="orbit-look-camera"]').trigger("click");
    expect(last(w)?.pad).toEqual({ style: "orbit" });
    // The orbit's keys move the around axis and keep the phrase row.
    await w.find('[data-test="orbit"] [role="slider"]').trigger("keydown", { key: "ArrowRight" });
    expect(rows(last(w)).map((s) => s.value).slice(0, 3)).toEqual([-30, 30, 0.5]);
    expect(rows(last(w))[3]?.var).toBe("light");
    w.unmount();
  });

  it("turns to Mix with the style example and blends from the triangle", async () => {
    const w = mount(SliderPadWidget, { props: { modelValue: three, dims: 3, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="pad-style-mix"]').trigger("click");
    const mix = last(w) ?? three;
    expect(mix?.pad).toEqual({ style: "mix" });
    expect(rows(mix).map((s) => s.var)).toEqual(["mix_a", "mix_b", "mix_c", "style_mix"]);
    await w.setProps({ modelValue: mix });
    expect(w.find('[data-test="mix"]').exists()).toBe(true);
    expect(w.find('[data-test="pad-shape-1"]').exists()).toBe(false);
    expect(w.find('[data-test="pad-swap"]').exists()).toBe(false);
    expect(w.findAll(".wp-tri__label").map((l) => l.text())).toEqual(["Watercolor 40%", "Ink sketch 30%", "Oil painting 30%"]);
    await w.find('[data-test="mix"] [role="slider"]').trigger("keydown", { key: "1" });
    expect(rows(last(w)).map((s) => s.value).slice(0, 3)).toEqual([1, 0, 0]);
    expect(rows(last(w))[3]?.var).toBe("style_mix");
    // A pad with a phrase already keeps its axes when it turns to Mix.
    await w.setProps({ modelValue: { ...mix, pad: {} } });
    await w.find('[data-test="pad-style-mix"]').trigger("click");
    expect(rows(last(w)).map((s) => s.value).slice(0, 3)).toEqual([0.4, 0.3, 0.3]);
    expect(last(w)?.pad).toEqual({ style: "mix" });
    w.unmount();
  });

  it("starts the style example again from the strip", async () => {
    const mix = { ...mixPreset(three), rows: rows(mixPreset(three)).map((s, i) => (i === 0 ? { ...s, name: "Mine" } : s)) };
    const w = mount(SliderPadWidget, { props: { modelValue: mix, dims: 3, editRequest: 1 } });
    await w.setProps({ editRequest: 2 });
    await w.find('[data-test="mix-example"]').trigger("click");
    expect(rows(last(w))[0]?.name).toBe("Watercolor");
    w.unmount();
  });

  it("opens the phrase row in the slider window, named Phrase", async () => {
    const plain = mount(SliderPadWidget, { props: { modelValue: three, dims: 3, editRequest: 1 } });
    await plain.setProps({ editRequest: 2 });
    expect(plain.find('[data-test="pad-edit-phrase"]').exists()).toBe(false);
    plain.unmount();
    const cam = orbitPreset(three, "camera");
    const w = mount(SliderPadWidget, { props: { modelValue: cam, dims: 3, editRequest: 1 }, attachTo: document.body });
    await w.setProps({ editRequest: 2 });
    await w.find('[data-test="pad-edit-phrase"]').trigger("click");
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(document.body.textContent).toContain("Phrase");
    expect(document.body.querySelector('[data-test="sl-pin"]')).toBeNull();
    w.unmount();
  });
});
