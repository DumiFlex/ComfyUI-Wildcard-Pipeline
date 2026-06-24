import { describe, it, expect, beforeEach } from "vitest";
import { currentFrame, setFrame } from "./frame-cursor";

describe("frame-cursor", () => {
  beforeEach(() => { currentFrame.value = null; });
  it("defaults to null (base)", () => { expect(currentFrame.value).toBe(null); });
  it("setFrame updates the shared ref", () => {
    setFrame(2);
    expect(currentFrame.value).toBe(2);
    setFrame(null);
    expect(currentFrame.value).toBe(null);
  });
});
