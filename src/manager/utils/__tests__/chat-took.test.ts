import { describe, expect, it } from "vitest";
import { tookLabel } from "../chat-took";

describe("tookLabel", () => {
  it("says how long an answer took, short", () => {
    expect(tookLabel(40)).toBe("0.1 s");
    expect(tookLabel(840)).toBe("0.8 s");
    expect(tookLabel(9_960)).toBe("10 s");
    expect(tookLabel(12_400)).toBe("12 s");
    expect(tookLabel(60_000)).toBe("1 min");
    expect(tookLabel(125_000)).toBe("2 min 5 s");
  });
  it("says nothing without a time", () => {
    expect(tookLabel(undefined)).toBe("");
    expect(tookLabel(-1)).toBe("");
  });
});
