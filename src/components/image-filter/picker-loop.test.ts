import { describe, it, expect } from "vitest";
import { frameParts, loopEdit, sweepGrid, type SweepAxisInfo } from "./picker-loop";
import { parseContextLoopConfig } from "../context-loop/types";
import type { FrameLabel } from "./types";

const color: SweepAxisInfo = { uid: "c1", name: "$color", labels: { r: "red", b: "blue" } };
const style: SweepAxisInfo = { uid: "s1", name: "$style", labels: { o: "oil", w: "watercolor", p: "pencil" } };

function sweep(): FrameLabel[] {
  const out: FrameLabel[] = [];
  for (const c of ["r", "b"]) for (const s of ["o", "w", "p"]) out.push({ loop_index: out.length, pins: { c1: c, s1: s } });
  return out;
}

describe("frameParts", () => {
  it("numbers by loop index and adds each swept option's text", () => {
    expect(frameParts({ loop_index: 2, pins: { c1: "b", s1: "w" } }, 0, [color, style])).toEqual(["#3", "blue", "watercolor"]);
  });
  it("falls back to the frame number and raw ids", () => {
    expect(frameParts(undefined, 4, [color])).toEqual(["#5"]);
    expect(frameParts({ pins: { c1: "zz" } }, 0, [color])).toEqual(["#1", "zz"]);
  });
});

describe("sweepGrid", () => {
  it("puts the last axis across and the others down", () => {
    const g = sweepGrid(sweep(), [color, style]);
    expect(g).toEqual({
      rows: ["red", "blue"],
      cols: ["oil", "watercolor", "pencil"],
      rowAxis: "$color",
      colAxis: "$style",
      cells: [[0, 1, 2], [3, 4, 5]],
    });
  });
  it("marks missing combinations with -1", () => {
    const labels = sweep().filter((l) => l.loop_index !== 4);
    expect(sweepGrid(labels, [color, style])?.cells).toEqual([[0, 1, 2], [3, -1, 4]]);
  });
  it("needs two axes and a pin for every axis on every frame", () => {
    expect(sweepGrid(sweep(), [color])).toBeNull();
    expect(sweepGrid([...sweep(), { loop_index: 9 }], [color, style])).toBeNull();
  });
});

describe("loopEdit", () => {
  it("locks picked frames' seeds and bypasses the rest", () => {
    const cfg = parseContextLoopConfig(JSON.stringify({ seed_locks: { "5": 1 }, bypass_frames: [1] }));
    const labels: FrameLabel[] = [
      { loop_index: 0, seed: 10 },
      { loop_index: 1, seed: 11 },
      { loop_index: 2, seed: 12 },
      {},
    ];
    const r = loopEdit(cfg, labels, new Set([1, 3]));
    expect(r.kept).toBe(1);
    expect(r.bypassed).toBe(2);
    expect(r.locked).toBe(1);
    expect(r.config.seed_locks).toEqual({ "5": 1, "1": 11 });
    expect(r.config.bypass_frames).toEqual([0, 2]);
  });
});
