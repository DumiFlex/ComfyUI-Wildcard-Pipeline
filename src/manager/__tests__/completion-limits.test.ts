import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completionLimit } from "../utils/tagSetting";

type G = { app?: unknown };

beforeEach(() => localStorage.clear());
afterEach(() => { delete (globalThis as G).app; });

describe("completion limits", () => {
  it("fall back to 20 suggestions and 3 characters", () => {
    expect(completionLimit("maxSuggestions")).toBe(20);
    expect(completionLimit("minChars")).toBe(3);
  });

  it("read the manager's stored value, clamped", () => {
    localStorage.setItem("wp-autocomplete-max-suggestions", "5");
    localStorage.setItem("wp-autocomplete-min-chars", "0");
    expect(completionLimit("maxSuggestions")).toBe(5);
    expect(completionLimit("minChars")).toBe(1);
  });

  it("read ComfyUI's setting on the canvas", () => {
    (globalThis as G).app = { extensionManager: { setting: { get: (id: string) =>
      id.endsWith("autocompleteMinChars") ? "2" : undefined } } };
    localStorage.setItem("wp-autocomplete-min-chars", "4");
    expect(completionLimit("minChars")).toBe(2);
  });
});
