import { describe, it, expect } from "vitest";
import { frameParts, loopEdit, moveAxis, sweepGrid, type SweepAxisInfo } from "./picker-loop";
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

const mood: SweepAxisInfo = { uid: "m1", name: "$mood", labels: { c: "calm", s: "stormy" } };

function sweep3(): FrameLabel[] {
  const out: FrameLabel[] = [];
  for (const c of ["r", "b"]) for (const s of ["o", "w", "p"]) for (const m of ["c", "s"]) {
    out.push({ loop_index: out.length, pins: { c1: c, s1: s, m1: m } });
  }
  return out;
}

describe("sweepGrid", () => {
  it("puts the first axis down and the second across", () => {
    const g = sweepGrid(sweep(), [color, style]);
    expect(g?.rowAxis).toEqual({ axis: 0, name: "$color" });
    expect(g?.colAxis).toEqual({ axis: 1, name: "$style" });
    expect(g?.splitAxes).toEqual([]);
    expect(g?.rows).toEqual(["red", "blue"]);
    expect(g?.cols).toEqual(["oil", "watercolor", "pencil"]);
    expect(g?.groups).toEqual([{ title: [], cells: [[0, 1, 2], [3, 4, 5]], frames: [0, 1, 2, 3, 4, 5] }]);
  });
  it("splits a third axis into one grid per value", () => {
    const g = sweepGrid(sweep3(), [color, style, mood]);
    expect(g?.splitAxes).toEqual([{ axis: 2, name: "$mood" }]);
    expect(g?.groups.map((x) => x.title)).toEqual([
      [{ axis: 2, name: "$mood", value: "calm" }],
      [{ axis: 2, name: "$mood", value: "stormy" }],
    ]);
    expect(g?.groups[0].cells).toEqual([[0, 2, 4], [6, 8, 10]]);
    expect(g?.groups[1].cells).toEqual([[1, 3, 5], [7, 9, 11]]);
  });
  it("follows the layout", () => {
    const g = sweepGrid(sweep3(), [color, style, mood], { rows: 2, cols: 0 });
    expect(g?.rows).toEqual(["calm", "stormy"]);
    expect(g?.cols).toEqual(["red", "blue"]);
    expect(g?.groups.map((x) => x.title[0].value)).toEqual(["oil", "watercolor", "pencil"]);
    expect(g?.groups[0].cells).toEqual([[0, 6], [1, 7]]);
  });
  it("marks missing combinations with -1", () => {
    const labels = sweep().filter((l) => l.loop_index !== 4);
    expect(sweepGrid(labels, [color, style])?.groups[0].cells).toEqual([[0, 1, 2], [3, -1, 4]]);
  });
  it("needs two axes, a valid layout and a pin for every axis on every frame", () => {
    expect(sweepGrid(sweep(), [color])).toBeNull();
    expect(sweepGrid(sweep(), [color, style], { rows: 1, cols: 1 })).toBeNull();
    expect(sweepGrid(sweep(), [color, style], { rows: 0, cols: 2 })).toBeNull();
    expect(sweepGrid([...sweep(), { loop_index: 9 }], [color, style])).toBeNull();
  });
});

describe("moveAxis", () => {
  it("puts an axis in a slot and swaps when it was in the other slot", () => {
    expect(moveAxis({ rows: 0, cols: 1 }, "rows", 2)).toEqual({ rows: 2, cols: 1 });
    expect(moveAxis({ rows: 0, cols: 1 }, "cols", 0)).toEqual({ rows: 1, cols: 0 });
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
