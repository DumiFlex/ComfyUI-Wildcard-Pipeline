import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, attachThemeDetector, detectInitialTheme } from "./theme-detector";

describe("theme-detector", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.body.classList.remove("dark-theme");
    document.documentElement.classList.remove("wp-theme-dark", "wp-theme-light");
  });

  describe("applyTheme", () => {
    it("adds wp-theme-dark + removes wp-theme-light when theme is dark", () => {
      host.classList.add("wp-theme-light");
      applyTheme(host, "dark");
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      expect(host.classList.contains("wp-theme-light")).toBe(false);
    });

    it("adds wp-theme-light + removes wp-theme-dark when theme is light", () => {
      host.classList.add("wp-theme-dark");
      applyTheme(host, "light");
      expect(host.classList.contains("wp-theme-light")).toBe(true);
      expect(host.classList.contains("wp-theme-dark")).toBe(false);
    });

    it("does not toggle when theme is already applied", () => {
      host.classList.add("wp-theme-dark");
      applyTheme(host, "dark");
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      expect(host.classList.contains("wp-theme-light")).toBe(false);
    });

    it("also applies the class to document.documentElement so teleported modals inherit", () => {
      applyTheme(host, "light");
      expect(document.documentElement.classList.contains("wp-theme-light")).toBe(true);
      expect(document.documentElement.classList.contains("wp-theme-dark")).toBe(false);

      applyTheme(host, "dark");
      expect(document.documentElement.classList.contains("wp-theme-dark")).toBe(true);
      expect(document.documentElement.classList.contains("wp-theme-light")).toBe(false);
    });
  });

  describe("detectInitialTheme — body.dark-theme observation", () => {
    it("returns 'dark' when <body> has the dark-theme class", () => {
      document.body.classList.add("dark-theme");
      expect(detectInitialTheme()).toBe("dark");
    });

    it("returns 'light' when <body> lacks the dark-theme class", () => {
      document.body.classList.remove("dark-theme");
      expect(detectInitialTheme()).toBe("light");
    });
  });

  describe("attachThemeDetector — MutationObserver", () => {
    it("applies initial theme based on body class", () => {
      document.body.classList.add("dark-theme");
      const cleanup = attachThemeDetector(host);
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      cleanup();
    });

    it("flips to light when dark-theme class is removed from body", async () => {
      document.body.classList.add("dark-theme");
      const cleanup = attachThemeDetector(host);
      expect(host.classList.contains("wp-theme-dark")).toBe(true);

      document.body.classList.remove("dark-theme");
      // MutationObserver fires asynchronously — yield to the microtask queue.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(host.classList.contains("wp-theme-light")).toBe(true);
      expect(host.classList.contains("wp-theme-dark")).toBe(false);
      cleanup();
    });

    it("flips to dark when dark-theme class is added to body", async () => {
      document.body.classList.remove("dark-theme");
      const cleanup = attachThemeDetector(host);
      expect(host.classList.contains("wp-theme-light")).toBe(true);

      document.body.classList.add("dark-theme");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
      expect(host.classList.contains("wp-theme-light")).toBe(false);
      cleanup();
    });

    it("disconnects the observer on cleanup so further body changes are ignored", async () => {
      document.body.classList.add("dark-theme");
      const cleanup = attachThemeDetector(host);
      cleanup();

      document.body.classList.remove("dark-theme");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // host class should NOT have flipped — observer is disconnected.
      expect(host.classList.contains("wp-theme-dark")).toBe(true);
    });
  });
});
