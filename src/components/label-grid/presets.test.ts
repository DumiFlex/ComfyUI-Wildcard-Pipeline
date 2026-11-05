import { describe, expect, it } from "vitest";
import { defaultLabelGridConfig, type LabelGridRun } from "../../extension/label-grid";
import {
  PRESETS,
  applyPreset,
  describeRun,
  headerSourceOptions,
  matchPreset,
  presetFields,
  suggestPreset,
  xyParts,
} from "./presets";

function run(over: Partial<LabelGridRun> = {}): LabelGridRun {
  return { items: 1, batchSizes: [1], count: 1, labelled: false, parts: [], auto: "fill", grid: null, ...over };
}

const SWEEP = run({
  items: 9, batchSizes: Array(9).fill(1), count: 9, labelled: true,
  parts: [
    { values: ["#1", "#2", "#3", "#4"], count: 9 },
    { values: ["dawn", "noon", "night"], count: 3 },
    { values: ["pastel", "vivid", "ink"], count: 3 },
  ],
});

describe("describeRun", () => {
  it("names the shape", () => {
    expect(describeRun(run())).toBe("1 image");
    expect(describeRun(run({ batchSizes: [9], count: 9 }))).toBe("1 batch of 9");
    expect(describeRun(run({ items: 5, batchSizes: [1, 1, 1, 1, 1], count: 5 }))).toBe("5 images");
    expect(describeRun(run({ items: 3, batchSizes: [4, 4, 4], count: 12 }))).toBe("3 frames × 4 images");
    expect(describeRun(run({ items: 2, batchSizes: [1, 3], count: 4 }))).toBe("2 frames, 4 images");
  });
});

describe("presets", () => {
  it("every preset's fields match back to it", () => {
    for (const p of PRESETS) {
      const cfg = applyPreset(defaultLabelGridConfig(), p.id, SWEEP);
      expect(matchPreset(cfg), p.id).toBe(p.id);
    }
  });

  it("frame presets head rows / columns with #N only when labels number frames", () => {
    const frames = run({
      items: 3, batchSizes: [2, 2, 2], count: 6, labelled: true,
      parts: [{ values: ["#1", "#2", "#3"], count: 3 }],
    });
    expect(presetFields("frames_rows", frames).rows_from).toBe("part:1");
    expect(presetFields("frames_cols", frames).columns_from).toBe("part:1");
    expect(presetFields("frames_rows", null).rows_from).toBe("none");
  });

  it("XY reads the two parts that vary, skipping frame numbers", () => {
    expect(xyParts(SWEEP)).toEqual([2, 3]);
    expect(presetFields("xy", SWEEP)).toMatchObject({ rows_from: "part:2", columns_from: "part:3" });
    expect(presetFields("xy", null)).toMatchObject({ rows_from: "part:2", columns_from: "part:3" });
    expect(xyParts(run({ labelled: true, count: 4, parts: [{ values: ["a"], count: 1 }] }))).toBeNull();
  });

  it("hand-set fields are no preset", () => {
    expect(matchPreset({ ...defaultLabelGridConfig(), arrange: "stack" })).toBeNull();
    expect(matchPreset({ ...defaultLabelGridConfig(), grid: false })).toBe("off");
  });

  it("suggests from the run's shape", () => {
    expect(suggestPreset(null)).toBeNull();
    expect(suggestPreset(run())).toBe("off");
    expect(suggestPreset(SWEEP)).toBe("xy");
    expect(suggestPreset(run({ batchSizes: [9], count: 9 }))).toBe("sheet");
    expect(suggestPreset(run({ items: 4, batchSizes: [1, 1, 1, 1], count: 4 }))).toBe("strip");
    expect(suggestPreset(run({ items: 8, batchSizes: Array(8).fill(1), count: 8 }))).toBe("sheet");
    expect(suggestPreset(run({ items: 3, batchSizes: [4, 4, 4], count: 12 }))).toBe("frames_rows");
  });
});

describe("headerSourceOptions", () => {
  it("shows each part's values", () => {
    const opts = headerSourceOptions(SWEEP);
    expect(opts.map((o) => o.value)).toEqual(["none", "typed", "part:1", "part:2", "part:3", "part:-1"]);
    expect(opts[3].label).toBe("Label part 2: dawn, noon, night");
    expect(opts[2].label).toBe("Label part 1: #1, #2, #3, …");
    expect(headerSourceOptions(null)).toHaveLength(6);
  });
});
