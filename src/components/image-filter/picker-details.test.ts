import { describe, it, expect } from "vitest";
import { filterValues, frameValues, isSwitchValue, promptRuns, valueDiff, valuesText } from "./picker-details";
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

  it("only marks whole words", () => {
    const rows = [{ name: "a", value: "camelto", axis: -1 }, { name: "b", value: "red", axis: -1 }];
    expect(promptRuns("cameltoe, red, redhead", rows)).toEqual([
      { text: "cameltoe, " },
      { text: "red", name: "b", axis: -1 },
      { text: ", redhead" },
    ]);
  });

  it("marks a value the cleaner trimmed or reordered piece by piece", () => {
    const rows = [{ name: "subject", value: "adult, petite, medium breasts, ", axis: -1 }];
    // As written (trailing comma trimmed off the value).
    expect(promptRuns("1girl, adult, petite, medium breasts", rows)).toEqual([
      { text: "1girl, " },
      { text: "adult, petite, medium breasts", name: "subject", axis: -1 },
    ]);
    // Reordered by a cleaner: each part is marked where it is.
    expect(promptRuns("medium breasts, 1girl, adult, petite", rows)).toEqual([
      { text: "medium breasts", name: "subject", axis: -1 },
      { text: ", 1girl, " },
      { text: "adult", name: "subject", axis: -1 },
      { text: ", " },
      { text: "petite", name: "subject", axis: -1 },
    ]);
  });

  it("copies values as $name: value lines", () => {
    expect(valuesText([{ name: "hair", value: "red", axis: 0 }], 42)).toBe("$hair: red\nseed: 42");
  });
});

describe("Values search and Compare differences", () => {
  const rows = [
    { name: "subject", value: "adult, petite", axis: -1 },
    { name: "pick_beach", value: "true", axis: -1 },
    { name: "place", value: "beach", axis: 0 },
    { name: "outdoor", value: "No", axis: -1 },
  ];
  it("filters by name or value and can hide on/off switches", () => {
    expect(filterValues(rows, "", false)).toHaveLength(4);
    expect(filterValues(rows, "", true).map((r) => r.name)).toEqual(["subject", "place"]);
    expect(filterValues(rows, "BEACH", false).map((r) => r.name)).toEqual(["pick_beach", "place"]);
    expect(filterValues(rows, "$sub", true).map((r) => r.name)).toEqual(["subject"]);
    expect(isSwitchValue(" off ")).toBe(true);
    expect(isSwitchValue("offset")).toBe(false);
  });
  it("lists only the values two images don't share", () => {
    const right = [rows[0], { name: "place", value: "office", axis: 0 }, { name: "time", value: "night", axis: -1 }];
    expect(valueDiff(rows, right)).toEqual([
      { name: "place", left: "beach", right: "office", axis: 0 },
      { name: "time", left: "", right: "night", axis: -1 },
      { name: "pick_beach", left: "true", right: "", axis: -1 },
      { name: "outdoor", left: "No", right: "", axis: -1 },
    ]);
  });
});
