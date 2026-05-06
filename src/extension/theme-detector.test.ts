import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, detectInitialTheme } from "./theme-detector";

describe("theme-detector", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  describe("applyTheme", () => {
    it("adds wp-theme-dark + removes wp-theme-light when palette is dark", () => {
      host.classList.add("wp-theme-light");
      applyTheme(host, "dark");
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      expect(host.classList.contains("wp-theme-light")).toBe(false);
    });

    it("adds wp-theme-light + removes wp-theme-dark when palette is light", () => {
      host.classList.add("wp-theme-dark");
      applyTheme(host, "light");
      expect(host.classList.contains("wp-theme-light")).toBe(true);
      expect(host.classList.contains("wp-theme-dark")).toBe(false);
    });

    it("does not toggle when palette is already applied", () => {
      host.classList.add("wp-theme-dark");
      applyTheme(host, "dark");
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      expect(host.classList.contains("wp-theme-light")).toBe(false);
    });
  });

  describe("detectInitialTheme", () => {
    it("returns 'dark' when extensionManager is unavailable", () => {
      expect(detectInitialTheme({})).toBe("dark");
    });

    it("returns 'light' when ColorPalette setting reads 'light'", () => {
      const app = { extensionManager: { setting: { get: vi.fn().mockReturnValue("light") } } };
      expect(detectInitialTheme(app)).toBe("light");
    });

    it("returns 'dark' when ColorPalette reads any other value", () => {
      const app = { extensionManager: { setting: { get: vi.fn().mockReturnValue("github") } } };
      expect(detectInitialTheme(app)).toBe("dark");
    });

    it("treats nullish setting as dark default", () => {
      const app = { extensionManager: { setting: { get: vi.fn().mockReturnValue(undefined) } } };
      expect(detectInitialTheme(app)).toBe("dark");
    });
  });
});
