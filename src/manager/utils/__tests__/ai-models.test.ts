import { describe, expect, it } from "vitest";
import { modelState } from "../ai-models";

describe("modelState", () => {
  it("marks a loaded local model green, with 'loaded'", () => {
    expect(modelState("qwen", true, ["qwen"])).toMatchObject({ dot: "var(--wp-success)", meta: "loaded" });
  });
  it("marks an unloaded local model grey", () => {
    expect(modelState("inkling", true, ["qwen"]).dot).toBe("var(--wp-text-dim)");
  });
  it("keeps the old marks when the server doesn't say", () => {
    expect(modelState("qwen", true, null)).toEqual({ dot: "var(--wp-success)" });
    expect(modelState("claude", false, null)).toEqual({ dot: "var(--wp-warn)" });
  });
});
