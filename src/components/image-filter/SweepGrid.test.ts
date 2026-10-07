import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SweepGrid from "./SweepGrid.vue";
import { sweepGrid, type SweepAxisInfo } from "./picker-loop";
import type { FrameLabel } from "./types";

const color: SweepAxisInfo = { uid: "c1", name: "$color", labels: { r: "red", b: "blue" } };
const style: SweepAxisInfo = { uid: "s1", name: "$style", labels: { o: "oil", w: "watercolor" } };
const mood: SweepAxisInfo = { uid: "m1", name: "$mood", labels: { c: "calm", s: "stormy" } };
const axes = [color, style, mood];

const labels: FrameLabel[] = [];
for (const c of ["r", "b"]) for (const s of ["o", "w"]) for (const m of ["c", "s"]) labels.push({ pins: { c1: c, s1: s, m1: m } });
const frames = labels.map((_, f) => [{ filename: `${f}.png`, subfolder: "", type: "temp" }]);

function mk(layout = { rows: 0, cols: 1 }) {
  const grid = sweepGrid(labels, axes, layout);
  if (!grid) throw new Error("no grid");
  return mount(SweepGrid, {
    props: { grid, axes, layout, frames, picked: new Set(["0:0"]), edits: {}, tooltip: () => "" },
  });
}

describe("SweepGrid", () => {
  it("draws one grid per split value with headers", () => {
    const w = mk();
    expect(w.findAll('[data-test^="image-filter-grid-group-"]')).toHaveLength(2);
    expect(w.find('[data-test="image-filter-grid-group-0"]').text()).toContain("calm");
    expect(w.find('[data-test="image-filter-grid-group-0"]').text()).toContain("1 of 4 picked");
    expect(w.find('[data-test="image-filter-grid-col-1-1"]').text()).toBe("watercolor");
  });

  it("row, column and group names pick their frames", async () => {
    const w = mk();
    await w.find('[data-test="image-filter-grid-row-0-1"]').trigger("click");
    await w.find('[data-test="image-filter-grid-col-1-0"]').trigger("click");
    await w.find('[data-test="image-filter-grid-group-1"] .wp-ifg__group-head').trigger("click");
    expect(w.emitted("toggleFrames")).toEqual([[[4, 6]], [[1, 5]], [[1, 3, 5, 7]]]);
  });

  it("choosing an axis for a slot moves it there", async () => {
    const w = mk();
    await w.find('[data-test="image-filter-grid-rows"]').setValue("2");
    await w.find('[data-test="image-filter-grid-swap"]').trigger("click");
    expect(w.emitted("update:layout")).toEqual([[{ rows: 2, cols: 1 }], [{ rows: 1, cols: 0 }]]);
  });
});
