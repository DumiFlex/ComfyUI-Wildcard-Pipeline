import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { completionSourceEnabled, enabledCompletionSources } from "../tagSetting";

/**
 * Three independently switchable sources, answered per host.
 *
 * The canvas has no Pinia at all, so it reads ComfyUI's own settings store; the
 * SPA reads localStorage directly rather than the Pinia store, because this is
 * a hot path called on every keystroke probe. An earlier version read the store
 * behind a try/catch, which silently disabled the whole feature on canvas —
 * fixing tests by hiding a missing implementation.
 */
describe("completion sources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe("on the SPA (no ComfyUI settings host)", () => {
    beforeEach(() => vi.stubGlobal("app", undefined));

    it("is off when nothing is stored", () => {
      expect(completionSourceEnabled("lora")).toBe(false);
    });

    it("reads each source from its own key", () => {
      localStorage.setItem("wp-lora-autocomplete", "1");
      expect(completionSourceEnabled("lora")).toBe(true);
      expect(completionSourceEnabled("embedding")).toBe(false);
      expect(completionSourceEnabled("tag")).toBe(false);
    });
  });

  describe("on the canvas", () => {
    const withCanvas = (values: Record<string, unknown>) =>
      vi.stubGlobal("app", {
        extensionManager: { setting: { get: (id: string) => values[id] } },
      });

    it("reads ComfyUI's settings store, not localStorage", () => {
      // Deliberately opposite values, so a wrong read is unambiguous rather
      // than accidentally correct.
      localStorage.setItem("wp-lora-autocomplete", "1");
      withCanvas({ "wildcardPipeline.behavior.loraAutocomplete": false });
      expect(completionSourceEnabled("lora")).toBe(false);
    });

    it("treats a throwing settings store as not-on-the-canvas", () => {
      vi.stubGlobal("app", {
        extensionManager: { setting: { get: () => { throw new Error("boom"); } } },
      });
      localStorage.setItem("wp-embedding-autocomplete", "1");
      expect(completionSourceEnabled("embedding")).toBe(true);
    });

    it("lists enabled sources in display order, tags first", () => {
      withCanvas({
        "wildcardPipeline.behavior.embeddingAutocomplete": true,
        "wildcardPipeline.behavior.tagAutocomplete": true,
      });
      expect(enabledCompletionSources()).toEqual(["tag", "embedding"]);
    });

    it("returns nothing when every source is off", () => {
      withCanvas({});
      expect(enabledCompletionSources()).toEqual([]);
    });
  });
});
