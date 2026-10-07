import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ImageFilterWidget from "./ImageFilterWidget.vue";
import { defaultImageFilterConfig, type ImageFilterConfig } from "./types";
import { parseRun, pickedThumbs } from "../../widgets/image_filter";

function mk(props: Record<string, unknown> = {}) {
  return mount(ImageFilterWidget, { props: { modelValue: defaultImageFilterConfig(), ...props } });
}
function lastEmit(w: ReturnType<typeof mk>): ImageFilterConfig {
  const all = w.emitted("update:modelValue") ?? [];
  return all[all.length - 1]?.[0] as ImageFilterConfig;
}

describe("ImageFilterWidget", () => {
  it("switches mode and the selects", async () => {
    const w = mk();
    await w.find('[data-test="if-mode-reuse"]').trigger("click");
    expect(lastEmit(w).mode).toBe("reuse");
    await w.find('[data-test="if-send-as"]').setValue("per_image");
    expect(lastEmit(w).send_as).toBe("per_image");
    expect(w.find('[data-test="if-nothing-picked"]').exists()).toBe(false);
  });

  it("timeout arrows step by 30 and never go below 0; 0 hides the after-timeout choice", async () => {
    const w = mk({ modelValue: { ...defaultImageFilterConfig(), timeout: 20 } });
    await w.find('[data-test="if-timeout-up"]').trigger("click");
    expect(lastEmit(w).timeout).toBe(50);
    await w.find('[data-test="if-timeout-down"]').trigger("click");
    expect(lastEmit(w).timeout).toBe(0);
    await w.setProps({ modelValue: { ...defaultImageFilterConfig(), timeout: 0 } });
    expect(w.find('[data-test="if-on-timeout"]').exists()).toBe(false);
    expect(w.text()).toContain("no limit");
  });

  it("summarises the last run", async () => {
    const w = mk();
    expect(w.find('[data-test="if-summary"]').text()).toContain("after a run");
    await w.setProps({ lastRun: { picks: [[0, 1], [2, 0]], frames: 3, total: 6, mode: "pause", stopped: false, edited: 0, masks: 0 } });
    expect(w.find('[data-test="if-summary"]').text()).toBe("2 of 6 kept · frames 1, 3");
    await w.setProps({ lastRun: { picks: [], frames: 1, total: 2, mode: "pause", stopped: true, edited: 0, masks: 0 } });
    expect(w.find('[data-test="if-summary"]').text()).toBe("stopped the branch");
    await w.setProps({ lastRun: { picks: [[0, 0]], frames: 1, total: 2, mode: "pause", stopped: false, edited: 1, masks: 2 } });
    expect(w.find('[data-test="if-summary"]').text()).toBe("1 of 2 kept · 1 prompt edited · 2 masks");
  });
});

describe("widget glue helpers", () => {
  it("parseRun reads the UI payload defensively", () => {
    expect(parseRun([{ picks: [[0, 1], ["x", 2]], frames: 2, total: 4, mode: "pause" }])).toEqual({
      picks: [[0, 1]], frames: 2, total: 4, mode: "pause", stopped: false, edited: 0, masks: 0,
    });
    expect(parseRun(null)).toBeNull();
  });

  it("pickedThumbs maps picks to the request's images", () => {
    const frames = [[{ filename: "a", subfolder: "", type: "temp" }], [{ filename: "b", subfolder: "", type: "temp" }]];
    const run = { picks: [[1, 0], [5, 5]] as [number, number][], frames: 2, total: 2, mode: "pause", stopped: false, edited: 0, masks: 0 };
    expect(pickedThumbs(run, frames).map((t) => t.filename)).toEqual(["b"]);
    expect(pickedThumbs(run, undefined)).toEqual([]);
  });
});
