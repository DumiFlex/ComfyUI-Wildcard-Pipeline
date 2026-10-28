import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/label-grid-config-corpus.json";
import {
  DEFAULT_LABEL_GRID_CONFIG,
  defaultLabelGridConfig,
  headerPart,
  parseLabelGridConfig,
  parseLabelGridRun,
} from "./label-grid";

describe("parseLabelGridConfig", () => {
  it.each(corpus.cases)("matches the engine: $name", (c) => {
    expect(parseLabelGridConfig(c.raw)).toEqual(c.expected);
  });

  it("starts from the defaults", () => {
    expect(parseLabelGridConfig(undefined)).toEqual(DEFAULT_LABEL_GRID_CONFIG);
    expect(defaultLabelGridConfig()).not.toBe(DEFAULT_LABEL_GRID_CONFIG);
  });
});

describe("headerPart", () => {
  it("reads part:N", () => {
    expect(headerPart("part:3")).toBe(3);
    expect(headerPart("part:-1")).toBe(-1);
    expect(headerPart("typed")).toBe(0);
    expect(headerPart("part:x")).toBe(0);
  });
});

describe("parseLabelGridRun", () => {
  it("reads the node's payload (a one-item list)", () => {
    const r = parseLabelGridRun([{
      items: 2, batch_sizes: [4, 4], count: 8, labelled: true,
      parts: [{ values: ["#1", "#2"], count: 2 }, "junk"], auto: "rows", grid: [100, 200],
    }]);
    expect(r).toEqual({
      items: 2, batchSizes: [4, 4], count: 8, labelled: true,
      parts: [{ values: ["#1", "#2"], count: 2 }], auto: "rows", grid: [100, 200],
    });
  });

  it("fills gaps and refuses non-objects", () => {
    expect(parseLabelGridRun(null)).toBeNull();
    expect(parseLabelGridRun("x")).toBeNull();
    const r = parseLabelGridRun({ batch_sizes: [2, 3], auto: "spiral" });
    expect(r).toMatchObject({ items: 2, count: 5, labelled: false, parts: [], auto: "auto", grid: null });
  });
});
