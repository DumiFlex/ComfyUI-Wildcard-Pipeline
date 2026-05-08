// Tests for the Display Playground store — exercises the bridge to
// ComfyUI's extensionManager.setting and the open/close ref.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  playgroundOpen,
  openPlayground,
  closePlayground,
  setComfyApp,
  getSettingValue,
  applySetting,
  _resetForTesting,
} from "./playground-store";

interface FakeApp {
  extensionManager?: {
    setting?: {
      get: (id: string) => unknown;
      set?: (id: string, value: unknown) => void;
    };
  };
}

function makeFakeApp(initial: Record<string, unknown> = {}): {
  app: FakeApp;
  store: Record<string, unknown>;
  setSpy: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = { ...initial };
  const setSpy = vi.fn((id: string, value: unknown) => {
    store[id] = value;
  });
  const app: FakeApp = {
    extensionManager: {
      setting: {
        get: (id: string) => store[id],
        set: setSpy,
      },
    },
  };
  return { app, store, setSpy };
}

describe("playground-store", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe("open/close", () => {
    it("openPlayground flips the ref to true", () => {
      expect(playgroundOpen.value).toBe(false);
      openPlayground();
      expect(playgroundOpen.value).toBe(true);
    });

    it("closePlayground flips the ref to false", () => {
      openPlayground();
      closePlayground();
      expect(playgroundOpen.value).toBe(false);
    });

    it("openPlayground twice is idempotent", () => {
      openPlayground();
      openPlayground();
      expect(playgroundOpen.value).toBe(true);
    });
  });

  describe("getSettingValue", () => {
    it("returns undefined when no app captured", () => {
      expect(getSettingValue("density")).toBeUndefined();
    });

    it("reads from extensionManager.setting.get with the dotted id", () => {
      const { app } = makeFakeApp({
        "wildcardPipeline.display.density": "compact",
        "wildcardPipeline.display.focusMode": true,
      });
      setComfyApp(app as never);

      expect(getSettingValue("density")).toBe("compact");
      expect(getSettingValue("focusMode")).toBe(true);
    });

    it("returns undefined for unknown keys", () => {
      const { app } = makeFakeApp();
      setComfyApp(app as never);

      expect(getSettingValue("density")).toBeUndefined();
    });
  });

  describe("applySetting", () => {
    it("no-ops when no app captured", () => {
      expect(() => applySetting("density", "compact")).not.toThrow();
    });

    it("calls extensionManager.setting.set with the dotted id and value", () => {
      const { app, setSpy } = makeFakeApp();
      setComfyApp(app as never);

      applySetting("density", "minimal");

      expect(setSpy).toHaveBeenCalledWith(
        "wildcardPipeline.display.density",
        "minimal",
      );
    });

    it("subsequent get returns the new value", () => {
      const { app } = makeFakeApp();
      setComfyApp(app as never);

      applySetting("decoration", "off");
      expect(getSettingValue("decoration")).toBe("off");
    });

    it("no-ops when running ComfyUI exposes setting.get only (set missing)", () => {
      const app: FakeApp = {
        extensionManager: {
          setting: { get: () => undefined },
        },
      };
      setComfyApp(app as never);

      // Optional chain on `setting.set?` keeps this safe rather than crashing.
      expect(() => applySetting("focusMode", true)).not.toThrow();
    });
  });

  describe("namespace routing", () => {
    it("display keys go under wildcardPipeline.display.*", () => {
      const { app, setSpy } = makeFakeApp();
      setComfyApp(app as never);

      applySetting("density", "compact");
      applySetting("kindStyle", "icon");
      applySetting("focusMode", true);

      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.display.density", "compact");
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.display.kindStyle", "icon");
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.display.focusMode", true);
    });

    it("a11y keys (reduceMotion, contrast) go under wildcardPipeline.a11y.*", () => {
      const { app, setSpy } = makeFakeApp();
      setComfyApp(app as never);

      applySetting("reduceMotion", "on");
      applySetting("contrast", "on");

      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.a11y.reduceMotion", "on");
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.a11y.contrast", "on");
    });

    it("getSettingValue routes a11y keys to the a11y namespace", () => {
      const { app } = makeFakeApp({
        "wildcardPipeline.a11y.reduceMotion": "on",
        "wildcardPipeline.a11y.contrast": "off",
        "wildcardPipeline.display.density": "compact",
      });
      setComfyApp(app as never);

      expect(getSettingValue("reduceMotion")).toBe("on");
      expect(getSettingValue("contrast")).toBe("off");
      expect(getSettingValue("density")).toBe("compact");
    });

    it("behavior keys go under wildcardPipeline.behavior.*", () => {
      const { app, setSpy } = makeFakeApp();
      setComfyApp(app as never);

      applySetting("validation", "permissive");
      applySetting("toastLifetime", "sticky");
      applySetting("suppressInfoToasts", true);
      applySetting("newModuleDisabled", true);

      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.behavior.validation", "permissive");
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.behavior.toastLifetime", "sticky");
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.behavior.suppressInfoToasts", true);
      expect(setSpy).toHaveBeenCalledWith("wildcardPipeline.behavior.newModuleDisabled", true);
    });

    it("getSettingValue routes behavior keys correctly", () => {
      const { app } = makeFakeApp({
        "wildcardPipeline.behavior.validation": "relaxed",
        "wildcardPipeline.behavior.toastLifetime": "long",
      });
      setComfyApp(app as never);

      expect(getSettingValue("validation")).toBe("relaxed");
      expect(getSettingValue("toastLifetime")).toBe("long");
    });
  });
});
