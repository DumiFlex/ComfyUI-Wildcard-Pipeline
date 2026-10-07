import { describe, it, expect, beforeEach } from "vitest";
import { clampFrame, currentFrame, setFrame } from "./frame-cursor";

describe("frame-cursor", () => {
  beforeEach(() => { currentFrame.value = null; });
  it("defaults to null (base)", () => { expect(currentFrame.value).toBe(null); });
  it("setFrame updates the shared ref", () => {
    setFrame(2);
    expect(currentFrame.value).toBe(2);
    setFrame(null);
    expect(currentFrame.value).toBe(null);
  });
  it("clampFrame sends a cursor past the count back to base", () => {
    setFrame(4);
    clampFrame(5);
    expect(currentFrame.value).toBe(4);
    clampFrame(4);
    expect(currentFrame.value).toBe(null);
  });
  it("clampFrame leaves base alone", () => {
    clampFrame(1);
    expect(currentFrame.value).toBe(null);
  });
});
