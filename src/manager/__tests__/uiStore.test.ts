import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../stores/uiStore";

beforeEach(() => {
  setActivePinia(createPinia());
  document.documentElement.className = "";
  localStorage.clear();
  vi.useFakeTimers();
});

describe("uiStore · density", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    setActivePinia(createPinia());
  });

  it("defaults to comfortable", () => {
    const ui = useUiStore();
    expect(ui.density).toBe("comfortable");
  });

  it("persists density to localStorage", () => {
    const ui = useUiStore();
    ui.setDensity("compact");
    expect(localStorage.getItem("wp-density-mode")).toBe("compact");
  });

  it("toggles html class", () => {
    const ui = useUiStore();
    ui.setDensity("compact");
    expect(document.documentElement.classList.contains("wp-density-compact")).toBe(true);
    ui.setDensity("comfortable");
    expect(document.documentElement.classList.contains("wp-density-compact")).toBe(false);
  });

  it("reads stored density on init", () => {
    localStorage.setItem("wp-density-mode", "compact");
    setActivePinia(createPinia());
    const ui = useUiStore();
    expect(ui.density).toBe("compact");
  });

  it("toggleDensity flips between modes", () => {
    const ui = useUiStore();
    ui.toggleDensity();
    expect(ui.density).toBe("compact");
    ui.toggleDensity();
    expect(ui.density).toBe("comfortable");
  });
});

describe("uiStore — theme cycle", () => {
  it("defaults to dark when no preference is stored", () => {
    const ui = useUiStore();
    expect(ui.themeMode).toBe("dark");
    expect(ui.resolvedTheme).toBe("dark");
  });

  it("cycles dark → light → auto → dark", () => {
    const ui = useUiStore();
    ui.cycleTheme(); expect(ui.themeMode).toBe("light");
    ui.cycleTheme(); expect(ui.themeMode).toBe("auto");
    ui.cycleTheme(); expect(ui.themeMode).toBe("dark");
  });

  it("persists the chosen mode to localStorage", () => {
    const ui = useUiStore();
    ui.setThemeMode("light");
    expect(localStorage.getItem("wp-theme-mode")).toBe("light");
  });

  it("applies wp-dark / wp-theme-light classes on initialize and removes flash class after window", () => {
    const ui = useUiStore();
    ui.setThemeMode("light");
    ui.initializeTheme();
    expect(document.documentElement.classList.contains("wp-theme-light")).toBe(true);
    expect(document.documentElement.classList.contains("wp-theme-switching")).toBe(true);
    vi.advanceTimersByTime(150);
    expect(document.documentElement.classList.contains("wp-theme-switching")).toBe(false);
  });

  it("reads a previously stored mode on init", () => {
    localStorage.setItem("wp-theme-mode", "auto");
    const ui = useUiStore();
    expect(ui.themeMode).toBe("auto");
  });
});

describe("uiStore · subcatDefault", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("defaults to 'populated'", () => {
    const ui = useUiStore();
    expect(ui.subcatDefault).toBe("populated");
  });

  it("persists a chosen value to localStorage", () => {
    const ui = useUiStore();
    ui.setSubcatDefault("always");
    expect(ui.subcatDefault).toBe("always");
    expect(localStorage.getItem("wp-subcat-default")).toBe("always");
  });

  it("reads a stored value on init, ignoring garbage", () => {
    localStorage.setItem("wp-subcat-default", "never");
    setActivePinia(createPinia());
    expect(useUiStore().subcatDefault).toBe("never");
    localStorage.setItem("wp-subcat-default", "bogus");
    setActivePinia(createPinia());
    expect(useUiStore().subcatDefault).toBe("populated");
  });
});
