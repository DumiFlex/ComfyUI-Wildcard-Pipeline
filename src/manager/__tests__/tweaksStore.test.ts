import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import {
  useTweaksStore,
  ACCENT_PALETTES,
} from "../stores/tweaksStore";

beforeEach(() => {
  setActivePinia(createPinia());
  // Wipe inline overrides + data-attr from prior tests so the document is
  // clean. Inline styles persist across tests in jsdom otherwise.
  const root = document.documentElement;
  root.style.cssText = "";
  root.removeAttribute("data-accent");
  localStorage.clear();
});

describe("tweaksStore — accent palette", () => {
  it("defaults to violet when no preference is stored", () => {
    const tweaks = useTweaksStore();
    expect(tweaks.accent).toBe("violet");
  });

  it("setAccent('indigo') writes the indigo palette to <html>", () => {
    const tweaks = useTweaksStore();
    tweaks.setAccent("indigo");
    const root = document.documentElement;
    expect(tweaks.accent).toBe("indigo");
    expect(root.style.getPropertyValue("--wp-accent-500")).toBe(
      ACCENT_PALETTES.indigo["--wp-accent-500"],
    );
    expect(root.style.getPropertyValue("--wp-accent-50")).toBe(
      ACCENT_PALETTES.indigo["--wp-accent-50"],
    );
    expect(root.getAttribute("data-accent")).toBe("indigo");
  });

  it("setAccent overwrites prior palette stops", () => {
    const tweaks = useTweaksStore();
    tweaks.setAccent("violet");
    tweaks.setAccent("rose");
    const v500 = document.documentElement.style.getPropertyValue("--wp-accent-500");
    expect(v500).toBe(ACCENT_PALETTES.rose["--wp-accent-500"]);
  });
});

describe("tweaksStore — density", () => {
  it("setDensity('compact') sets --wp-input-h to 32px", () => {
    const tweaks = useTweaksStore();
    tweaks.setDensity("compact");
    expect(tweaks.density).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--wp-input-h")).toBe("32px");
    expect(document.documentElement.style.getPropertyValue("--wp-btn-h")).toBe("32px");
  });

  it("setDensity('comfortable') sets --wp-input-h to 38px", () => {
    const tweaks = useTweaksStore();
    tweaks.setDensity("comfortable");
    expect(document.documentElement.style.getPropertyValue("--wp-input-h")).toBe("38px");
  });
});

describe("tweaksStore — panel state", () => {
  it("togglePanel flips panelOpen", () => {
    const tweaks = useTweaksStore();
    expect(tweaks.panelOpen).toBe(false);
    tweaks.togglePanel();
    expect(tweaks.panelOpen).toBe(true);
    tweaks.togglePanel();
    expect(tweaks.panelOpen).toBe(false);
  });

  it("closePanel forces panelOpen=false", () => {
    const tweaks = useTweaksStore();
    tweaks.togglePanel();
    expect(tweaks.panelOpen).toBe(true);
    tweaks.closePanel();
    expect(tweaks.panelOpen).toBe(false);
  });
});

describe("tweaksStore — reset", () => {
  it("clears inline CSS-var overrides and localStorage entry", async () => {
    const tweaks = useTweaksStore();
    tweaks.setAccent("amber");
    tweaks.setDensity("compact");
    // Wait a microtask for the persist watcher to flush.
    await Promise.resolve();
    expect(localStorage.getItem("wp-tweaks-v1")).not.toBeNull();

    tweaks.reset();
    await Promise.resolve();

    expect(tweaks.accent).toBe("violet");
    expect(tweaks.density).toBe("comfortable");
    expect(document.documentElement.style.getPropertyValue("--wp-accent-500")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--wp-input-h")).toBe("");
    // Watcher writes the post-reset state, so the key may exist with the
    // default snapshot; only assert it doesn't carry the prior amber accent.
    const raw = localStorage.getItem("wp-tweaks-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.accent).toBe("violet");
      expect(parsed.density).toBe("comfortable");
    }
  });
});

describe("tweaksStore — persistence", () => {
  it("setAccent writes to localStorage under wp-tweaks-v1", async () => {
    const tweaks = useTweaksStore();
    tweaks.setAccent("teal");
    // Allow the watcher to flush.
    await Promise.resolve();
    const raw = localStorage.getItem("wp-tweaks-v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.accent).toBe("teal");
  });

  it("a fresh store reads back persisted accent + density", () => {
    localStorage.setItem(
      "wp-tweaks-v1",
      JSON.stringify({ accent: "rose", density: "compact", sidebarMode: "collapsed" }),
    );
    setActivePinia(createPinia());
    const tweaks = useTweaksStore();
    expect(tweaks.accent).toBe("rose");
    expect(tweaks.density).toBe("compact");
    expect(tweaks.sidebarMode).toBe("collapsed");
  });

  it("initialize() applies persisted values to <html>", () => {
    localStorage.setItem(
      "wp-tweaks-v1",
      JSON.stringify({ accent: "amber", density: "compact" }),
    );
    setActivePinia(createPinia());
    const tweaks = useTweaksStore();
    tweaks.initialize();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--wp-accent-500")).toBe(
      ACCENT_PALETTES.amber["--wp-accent-500"],
    );
    expect(root.style.getPropertyValue("--wp-input-h")).toBe("32px");
  });
});
