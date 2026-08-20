import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computed } from "vue";
import {
  completionSettingsVersion,
  completionSourceEnabled,
  notifyCompletionSettingsChanged,
} from "../tagSetting";

/**
 * Flipping a source on used to do nothing until the page was reloaded.
 *
 * The readers ask ComfyUI's settings store (or localStorage) directly, and
 * neither is a Vue reactive source — so a `computed` built on them caches on
 * its OTHER dependencies and never re-evaluates. The version counter is the
 * dependency that makes it re-evaluate.
 */
describe("completion settings reactivity", () => {
  let enabled = false;

  beforeEach(() => {
    enabled = false;
    vi.stubGlobal("app", {
      extensionManager: { setting: { get: () => enabled } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a computed over the raw reader goes stale — the bug", () => {
    const gate = computed(() => completionSourceEnabled("lora"));
    expect(gate.value).toBe(false);
    enabled = true;
    // Nothing told Vue, so the cached `false` stands. This is what a page
    // reload was working around.
    expect(gate.value).toBe(false);
  });

  it("reading the version makes the same computed pick the change up", () => {
    const gate = computed(() => {
      void completionSettingsVersion.value;
      return completionSourceEnabled("lora");
    });
    expect(gate.value).toBe(false);
    enabled = true;
    notifyCompletionSettingsChanged();
    expect(gate.value).toBe(true);
  });

  it("the counter only ever moves forward, so every change invalidates", () => {
    const before = completionSettingsVersion.value;
    notifyCompletionSettingsChanged();
    notifyCompletionSettingsChanged();
    expect(completionSettingsVersion.value).toBe(before + 2);
  });
});
