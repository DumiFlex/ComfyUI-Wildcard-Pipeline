import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SliderPadWidget from "../SliderPadWidget.vue";
import { padConfig, type SliderRow, type SlidersConfig } from "../../../extension/sliders";

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
});
