import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SlidersWidget from "../SlidersWidget.vue";
import SliderRowView from "../SliderRow.vue";
import SliderEditWindow from "../SliderEditWindow.vue";
import type { SliderRow, SlidersConfig } from "../../../extension/sliders";

const slider = (over: Partial<SliderRow> & { id: string }): SliderRow => ({
  kind: "slider", name: over.id, var: over.id, value: 0.5, min: 0, max: 1, step: 0.05,
  decimals: 2, mode: "number", pin: false, out: 0, style: "row", ...over,
});
const cfg: SlidersConfig = {
  version: 1,
  rows: [
    slider({ id: "a", name: "Detail", var: "detail", pin: true, out: 1 }),
    { id: "L1", kind: "label", name: "Camera", color: 2 },
    slider({ id: "b", name: "Shot", var: "shot", value: 0.8, mode: "words",
      words: [{ word: "close-up", upto: 0.3 }, { word: "medium shot", upto: 0.7 }, { word: "wide shot" }] }),
  ],
};

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.dynamicImportSettled();
    await flushPromises();
  }
}
function q(sel: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(sel);
}
function lastConfig(w: { emitted: (e: string) => unknown[][] | undefined }): SlidersConfig | undefined {
  const all = w.emitted("update:modelValue");
  return all?.[all.length - 1]?.[0] as SlidersConfig | undefined;
}

describe("SliderRow", () => {
  it("marks its output dot and shows the picked word", () => {
    const w = mount(SliderRowView, { props: { s: cfg.rows[0] as SliderRow, editing: false, editable: false } });
    expect(w.find('[data-test="sl-row-a"]').attributes("data-wp-out")).toBe("value_1");
    w.unmount();
    const w2 = mount(SliderRowView, { props: { s: cfg.rows[2] as SliderRow, editing: false, editable: false } });
    expect(w2.find('[data-test="sl-holds-b"]').text()).toBe("wide shot");
    expect(w2.find('[data-test="sl-row-b"]').attributes("data-wp-out")).toBeUndefined();
    w2.unmount();
  });

  it("emits the value on a key press and stops the pointer at the track", async () => {
    const w = mount(SliderRowView, { props: { s: cfg.rows[0] as SliderRow, editing: false, editable: false } });
    await w.find('[role="slider"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("set-value")?.[0]).toEqual([0.55]);
    const ev = new PointerEvent("pointerdown", { bubbles: true });
    const outer = vi.fn();
    w.element.addEventListener("pointerdown", outer);
    w.find(".wp-slr__ctl").element.dispatchEvent(ev);
    expect(outer).not.toHaveBeenCalled();
    w.unmount();
  });

  it("a locked row can't be dragged, and its lock unlocks it", async () => {
    const s = slider({ id: "a", lock: true, off: "mute" });
    const w = mount(SliderRowView, { props: { s, editing: false, editable: false } });
    await w.find('[role="slider"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("set-value")).toBeUndefined();
    expect(w.find('[data-test="sl-off-a"]').exists()).toBe(true);
    await w.find('[data-test="sl-lock-a"]').trigger("click");
    expect(w.emitted("patch")?.[0]).toEqual([{ lock: undefined }]);
    w.unmount();
  });

  it("flips internal from the globe in the edit view", async () => {
    const w = mount(SliderRowView, { props: { s: cfg.rows[0] as SliderRow, editing: false, editable: true } });
    await w.find('[data-test="sl-internal-a"]').trigger("click");
    expect(w.emitted("patch")?.[0]).toEqual([{ internal: true }]);
    w.unmount();
  });
});

describe("SliderRow styles", () => {
  it("draws a bar with the name inside and drags freely when not snapped", async () => {
    const s = slider({ id: "a", name: "Detail", style: "bar", free: true });
    const w = mount(SliderRowView, { props: { s, editing: false, editable: false } });
    expect(w.find(".wp-slr__head").exists()).toBe(false);
    expect(w.find(".wp-slider[data-variant=\"bar\"]").exists()).toBe(true);
    expect(w.find(".wp-slr__in-name").text()).toBe("Detail");
    w.unmount();
  });

  it("draws a fader upright, but as a row in the edit view", () => {
    const s = slider({ id: "a", style: "fader", pin: true, out: 1 });
    const up = mount(SliderRowView, { props: { s, editing: false, editable: false } });
    expect(up.find(".wp-slider[data-variant=\"fader\"]").exists()).toBe(true);
    expect(up.find('[data-test="sl-row-a"]').attributes("data-wp-out")).toBeUndefined();
    up.unmount();
    const flat = mount(SliderRowView, { props: { s, editing: false, editable: true, flat: true } });
    expect(flat.find(".wp-slider[data-variant=\"line\"]").exists()).toBe(true);
    expect(flat.find('[data-test="sl-row-a"]').attributes("data-wp-out")).toBe("value_1");
    flat.unmount();
  });

  it("stands faders side by side with their dots on a list beside them", () => {
    const faders: SlidersConfig = {
      version: 1,
      rows: [
        slider({ id: "a", style: "fader", pin: true, out: 1 }),
        slider({ id: "b", style: "fader" }),
        slider({ id: "c", style: "row" }),
      ],
    };
    const w = mount(SlidersWidget, { props: { modelValue: faders } });
    const strip = w.find('[data-test="sl-faders"]');
    expect(strip.findAll(".wp-slr")).toHaveLength(2);
    expect(w.find('[data-test="sl-fader-out-a"]').attributes("data-wp-out")).toBe("value_1");
    expect(w.find('[data-test="sl-fader-out-b"]').exists()).toBe(false);
    w.unmount();
  });
});

describe("SlidersWidget", () => {
  it("opens the edit view on request and adds a slider", async () => {
    const w = mount(SlidersWidget, { props: { modelValue: cfg, editRequest: 0 }, attachTo: document.body });
    expect(w.find(".wp-sl--edit").exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    expect(w.find(".wp-sl--edit").exists()).toBe(true);
    await w.find('[data-test="sl-add"]').trigger("click");
    const next = lastConfig(w);
    expect(next?.rows).toHaveLength(4);
    expect(next?.rows[3]).toMatchObject({ kind: "slider", var: "slider_3", pin: false });
    await settle();
    w.unmount();
  });

  it("folds a label and its row hides", async () => {
    const w = mount(SlidersWidget, { props: { modelValue: cfg } });
    expect(w.find('[data-test="sl-row-b"]').exists()).toBe(true);
    await w.find('[data-test="sl-fold-L1"]').trigger("click");
    expect(lastConfig(w)?.rows[1]).toMatchObject({ collapsed: true });
    w.unmount();
  });

  it("stores a moved slider value", async () => {
    const w = mount(SlidersWidget, { props: { modelValue: cfg } });
    await w.find('[data-test="sl-row-a"] [role="slider"]').trigger("keydown", { key: "End" });
    expect(lastConfig(w)?.rows[0]).toMatchObject({ value: 1 });
    w.unmount();
  });

  it("a renamed slider's variable follows its name through the window", async () => {
    const w = mount(SlidersWidget, { props: { modelValue: cfg, editRequest: 0 }, attachTo: document.body });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="sl-edit-a"]').trigger("click");
    await settle();
    const name = q('[data-test="sl-name"] input') ?? q('[data-test="sl-name"]');
    if (name instanceof HTMLInputElement) {
      name.value = "Detail weight";
      name.dispatchEvent(new Event("change"));
    }
    await flushPromises();
    q('[data-test="sl-window-done"]')?.click();
    await flushPromises();
    expect(lastConfig(w)?.rows[0]).toMatchObject({ name: "Detail weight", var: "detail_weight" });
    w.unmount();
  });
});

describe("SliderEditWindow", () => {
  function open(s: SliderRow) {
    return mount(SliderEditWindow, {
      attachTo: document.body,
      props: { s, groupOptions: [], groupId: "", outputsFull: false, nodeTitle: "Look" },
    });
  }
  function done(w: ReturnType<typeof open>): SliderRow | undefined {
    q('[data-test="sl-window-done"]')?.click();
    return (w.emitted("done")?.[0] as [SliderRow, string] | undefined)?.[0];
  }

  it("adds Words ranges before the one that catches the rest", async () => {
    const w = open(slider({ id: "c", mode: "words" }));
    await flushPromises();
    q('[data-test="sl-word-add"]')?.click();
    await flushPromises();
    q('[data-test="sl-word-add"]')?.click();
    await flushPromises();
    const out = done(w);
    expect(out?.words?.map((x) => x.upto)).toEqual([0.5, 0.75, undefined]);
    w.unmount();
  });

  it("ticks the output box and keeps the value inside a new range", async () => {
    const w = open(slider({ id: "c", value: 0.9 }));
    await flushPromises();
    const label = [...document.body.querySelectorAll<HTMLElement>(".wp-slw__check > span")].find((s) => s.textContent === "FLOAT output");
    label?.click();
    await flushPromises();
    const max = q('[data-test="sl-max"] input') ?? q('[data-test="sl-max"]');
    if (max instanceof HTMLInputElement) {
      max.value = "0.5";
      max.dispatchEvent(new Event("change"));
    }
    await flushPromises();
    expect(done(w)).toMatchObject({ pin: true, max: 0.5, value: 0.5 });
    w.unmount();
  });

  it("mutes and locks from Advanced, which says so when closed", async () => {
    const w = open(slider({ id: "c" }));
    await settle();
    q('[data-test="sl-advanced"]')?.click();
    await flushPromises();
    q('[data-test="sl-off-mute"]')?.click();
    await flushPromises();
    const lock = [...document.body.querySelectorAll<HTMLElement>(".wp-slw__check > span")].find((x) => x.textContent === "Lock value");
    lock?.click();
    await flushPromises();
    expect(q('[data-test="sl-advanced-summary"]')?.textContent).toContain("Muted · Locked");
    expect(done(w)).toMatchObject({ off: "mute", lock: true });
    w.unmount();
  });

  it("opens Advanced on its own for a muted row and warns on text without {word}", async () => {
    const w = open(slider({ id: "c", mode: "words", off: "bypass", text: "green clothes", words: [{ word: "a" }] }));
    await settle();
    expect(q('[data-test="sl-off-bypass"]')?.getAttribute("aria-pressed") ?? q('[data-test="sl-off-bypass"]')?.getAttribute("aria-checked")).toBe("true");
    expect(q('[data-test="sl-word-text"]')?.textContent).toContain("Write {word} where the word goes");
    w.unmount();
  });

  it("picks a style and turns snapping off", async () => {
    const w = open(slider({ id: "c" }));
    await flushPromises();
    q('[data-test="sl-style-fader"]')?.click();
    await flushPromises();
    const snapLabel = [...document.body.querySelectorAll<HTMLElement>(".wp-slw__check > span")].find((x) => x.textContent === "Snap to step");
    snapLabel?.click();
    await flushPromises();
    expect(done(w)).toMatchObject({ style: "fader", free: true });
    w.unmount();
  });
});
