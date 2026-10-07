import { describe, it, expect } from "vitest";
import { frameValues, promptRuns, valuesText } from "./picker-details";
import type { SweepAxisInfo } from "./picker-loop";

const hair: SweepAxisInfo = { uid: "h1", name: "$hair", labels: { b: "blonde hair" } };

describe("picker details", () => {
  it("lists swept variables first, then the rest", () => {
    const rows = frameValues({ pins: { h1: "b" }, vars: { mood: "joyful", hair: "blonde hair" } }, [hair]);
    expect(rows).toEqual([
      { name: "hair", value: "blonde hair", axis: 0 },
      { name: "mood", value: "joyful", axis: -1 },
    ]);
  });

  it("falls back to the pinned option text when the variable wasn't sent", () => {
    expect(frameValues({ pins: { h1: "b" } }, [hair])).toEqual([{ name: "hair", value: "blonde hair", axis: 0 }]);
    expect(frameValues(undefined, [hair])).toEqual([]);
  });

  it("marks where each value lands in the prompt, longest first", () => {
    const rows = [
      { name: "hair", value: "blonde hair", axis: 0 },
      { name: "color", value: "blonde", axis: -1 },
      { name: "x", value: "a", axis: -1 },
    ];
    expect(promptRuns("1girl, blonde hair, blonde", rows)).toEqual([
      { text: "1girl, " },
      { text: "blonde hair", name: "hair", axis: 0 },
      { text: ", " },
      { text: "blonde", name: "color", axis: -1 },
    ]);
    expect(promptRuns("", rows)).toEqual([]);
  });

  it("copies values as $name: value lines", () => {
    expect(valuesText([{ name: "hair", value: "red", axis: 0 }], 42)).toBe("$hair: red\nseed: 42");
  });
});
