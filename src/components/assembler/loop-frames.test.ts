import { describe, expect, it } from "vitest";
import { frameList, frameSentence, frameTag, otherFrames } from "./loop-frames";

describe("loop-frames words", () => {
  it("joins runs of frames, 1-based", () => {
    expect(frameList([0, 1, 2, 4])).toBe("1–3, 5");
    expect(frameList([3])).toBe("4");
    expect(frameList([0, 1])).toBe("1, 2");
    expect(frameList([])).toBe("");
  });

  it("lists the other frames", () => {
    expect(otherFrames([3], 4)).toEqual([0, 1, 2]);
  });

  it("tags one or two frames by number, more by share", () => {
    expect(frameTag([3], 4)).toBe("#4");
    expect(frameTag([0, 3], 4)).toBe("#1 #4");
    expect(frameTag([0, 1, 3], 4)).toBe("3/4");
  });

  it("says where the name is set and where it is empty", () => {
    expect(frameSentence("companion", [3], 4)).toBe(
      "$companion is set on frame 4 only. Frames 1–3 render it empty.",
    );
    expect(frameSentence("companion", [0, 1, 3], 4)).toBe(
      "$companion is set on frames 1, 2, 4. Frame 3 renders it empty.",
    );
  });
});
