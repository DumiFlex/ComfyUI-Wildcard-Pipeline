import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetPaletteForTests,
  contrast,
  derivePaletteTokens,
  paletteIsLight,
  paletteSheet,
  parseColor,
  readPaletteBase,
  setCanvasColorsMode,
  syncPalette,
  watchPalette,
  type PaletteBase,
  type Rgb,
} from "./comfy-palette";

const must = (s: string): Rgb => {
  const c = parseColor(s);
  if (!c) throw new Error(`bad colour ${s}`);
  return c;
};

/** `litegraph_base` of ComfyUI's core palettes plus Easy-Use's Milk White
 *  (ComfyUI_frontend src/assets/palettes, Easy-Use-Frontend constants/theme). */
const PALETTES: Record<string, { light?: boolean; lg: Record<string, string> }> = {
  dark: { lg: { NODE_DEFAULT_BGCOLOR: "#353535", WIDGET_BGCOLOR: "#222", WIDGET_TEXT_COLOR: "#DDD", WIDGET_SECONDARY_TEXT_COLOR: "#999", CLEAR_BACKGROUND_COLOR: "#141414" } },
  light: { light: true, lg: { NODE_DEFAULT_BGCOLOR: "#F5F5F5", WIDGET_BGCOLOR: "#D4D4D4", WIDGET_TEXT_COLOR: "#222", WIDGET_SECONDARY_TEXT_COLOR: "#555", CLEAR_BACKGROUND_COLOR: "#d3d3d3" } },
  nord: { lg: { NODE_DEFAULT_BGCOLOR: "#161b22", WIDGET_BGCOLOR: "#2e3440", WIDGET_TEXT_COLOR: "#bcc2c8", WIDGET_SECONDARY_TEXT_COLOR: "#999", CLEAR_BACKGROUND_COLOR: "#212732" } },
  solarized: { lg: { NODE_DEFAULT_BGCOLOR: "#073642", WIDGET_BGCOLOR: "#002b36", WIDGET_TEXT_COLOR: "#fdf6e3", WIDGET_SECONDARY_TEXT_COLOR: "#93a1a1", CLEAR_BACKGROUND_COLOR: "#002b36" } },
  arc: { lg: { NODE_DEFAULT_BGCOLOR: "#242730", WIDGET_BGCOLOR: "#2b2f38", WIDGET_TEXT_COLOR: "#DDD", WIDGET_SECONDARY_TEXT_COLOR: "#b2b7bd", CLEAR_BACKGROUND_COLOR: "#2b2f38" } },
  github: { lg: { NODE_DEFAULT_BGCOLOR: "#13171d", WIDGET_BGCOLOR: "#161b22", WIDGET_TEXT_COLOR: "#bcc2c8", WIDGET_SECONDARY_TEXT_COLOR: "#999", CLEAR_BACKGROUND_COLOR: "#040506" } },
  milk_white: { lg: { NODE_DEFAULT_BGCOLOR: "#F5F5F5", WIDGET_BGCOLOR: "#D4D4D4", WIDGET_TEXT_COLOR: "#222", WIDGET_SECONDARY_TEXT_COLOR: "#555", CLEAR_BACKGROUND_COLOR: "#d3d3d3" } },
};

function baseOf(lg: Record<string, string>): PaletteBase {
  return {
    surface: must(lg.WIDGET_BGCOLOR ?? ""),
    node: must(lg.NODE_DEFAULT_BGCOLOR ?? ""),
    text: must(lg.WIDGET_TEXT_COLOR ?? ""),
    text2: must(lg.WIDGET_SECONDARY_TEXT_COLOR ?? ""),
    canvas: must(lg.CLEAR_BACKGROUND_COLOR ?? ""),
  };
}

type G = { LiteGraph?: unknown };

function appWith(palette: unknown) {
  return { extensionManager: { colorPalette: { getActiveColorPalette: () => palette } } };
}

describe("parseColor", () => {
  it.each([
    ["#abc", { r: 0xaa, g: 0xbb, b: 0xcc }],
    ["#abcd", { r: 0xaa, g: 0xbb, b: 0xcc }],
    ["#0a1b2c", { r: 10, g: 27, b: 44 }],
    ["#0a1b2c80", { r: 10, g: 27, b: 44 }],
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3 }],
    ["rgba(1,2,3,0.5)", { r: 1, g: 2, b: 3 }],
    ["rgb(1 2 3 / 50%)", { r: 1, g: 2, b: 3 }],
    ["color(srgb 1 0.5 0)", { r: 255, g: 128, b: 0 }],
  ])("reads %s", (input, want) => {
    expect(parseColor(input)).toEqual(want);
  });

  it("refuses what it can't read without the DOM", () => {
    expect(parseColor("lightgray")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });
});

describe("derivePaletteTokens", () => {
  it("lands core Dark close to the hand-tuned dark set", () => {
    const t = derivePaletteTokens(baseOf(PALETTES.dark?.lg ?? {}), false);
    expect(t["--wp-bg"]).toBe("#222222");
    expect(t["--wp-text"]).toBe("#dddddd");
    // Within a few levels of theme.css: border #3a3a3a, border2 #4a4a4a.
    const near = (a: string | undefined, b: string) => {
      const x = must(a ?? "");
      const y = must(b);
      return Math.abs(x.r - y.r) <= 6;
    };
    expect(near(t["--wp-border"], "#3a3a3a")).toBe(true);
    expect(near(t["--wp-border2"], "#4a4a4a")).toBe(true);
    expect(near(t["--wp-bg4"], "#333333")).toBe(true);
  });

  it.each(Object.entries(PALETTES))("keeps text readable on %s", (_id, p) => {
    const base = baseOf(p.lg);
    const t = derivePaletteTokens(base, p.light === true || _id === "milk_white");
    const bg = must(t["--wp-bg"] ?? "");
    expect(contrast(must(t["--wp-text"] ?? ""), bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(must(t["--wp-text2"] ?? ""), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(must(t["--wp-text3"] ?? ""), bg)).toBeGreaterThanOrEqual(2.5);
    expect(contrast(must(t["--wp-accent-text"] ?? ""), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(must(t["--wp-node-text"] ?? ""), base.node)).toBeGreaterThanOrEqual(4.5);
  });

  it("swaps in our own text when the palette's text doesn't read", () => {
    const base = baseOf({ ...PALETTES.nord?.lg, WIDGET_TEXT_COLOR: "#3b4252", WIDGET_SECONDARY_TEXT_COLOR: "#434c5e" });
    const t = derivePaletteTokens(base, false);
    const bg = must(t["--wp-bg"] ?? "");
    expect(contrast(must(t["--wp-text"] ?? ""), bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(must(t["--wp-text2"] ?? ""), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("ramps surfaces away from the base toward the text", () => {
    const t = derivePaletteTokens(baseOf(PALETTES.solarized?.lg ?? {}), false);
    expect(t["--wp-bg"]).toBe("#002b36");
    expect(t["--wp-bg-2"]).toBe(t["--wp-bg2"]);
    expect(t["--wp-node-bg"]).toBe("#073642");
    expect(t["--wp-canvas-bg"]).toBe("#002b36");
    const order = ["--wp-bg", "--wp-bg2", "--wp-bg3", "--wp-bg4", "--wp-border", "--wp-border2"]
      .map((k) => must(t[k] ?? "").r + must(t[k] ?? "").g + must(t[k] ?? "").b);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("paletteSheet", () => {
  it("reaches widget hosts but lets High contrast win", () => {
    const css = paletteSheet({ "--wp-bg": "#000000" });
    expect(css).toContain(":root.wp-palette-follow:not(.wp-manager)");
    expect(css).toContain("body:not(.wp-a11y-high-contrast) :is(.wp-theme-dark, .wp-theme-light, .wp-canvas-scope)");
    expect(css).toContain("--wp-bg: #000000;");
  });
});

describe("reading and applying", () => {
  beforeEach(() => {
    _resetPaletteForTests();
    delete (globalThis as G).LiteGraph;
  });
  afterEach(() => {
    _resetPaletteForTests();
    delete (globalThis as G).LiteGraph;
  });

  it("reads the LiteGraph globals first", () => {
    (globalThis as G).LiteGraph = { ...PALETTES.nord?.lg };
    const r = readPaletteBase(appWith({ id: "nord", colors: { litegraph_base: PALETTES.dark?.lg } }));
    expect(r.id).toBe("nord");
    expect(r.base?.surface).toEqual(must("#2e3440"));
  });

  it("falls back to the palette object", () => {
    const r = readPaletteBase(appWith({ id: "arc", colors: { litegraph_base: PALETTES.arc?.lg } }));
    expect(r.base?.node).toEqual(must("#242730"));
  });

  it("has no base when nothing paints", () => {
    expect(readPaletteBase(undefined).base).toBeNull();
    expect(paletteIsLight(undefined)).toBeUndefined();
  });

  it("counts a white palette without light_theme as light", () => {
    (globalThis as G).LiteGraph = { ...PALETTES.milk_white?.lg };
    expect(paletteIsLight(appWith({ id: "milk_white" }))).toBe(true);
    (globalThis as G).LiteGraph = { ...PALETTES.nord?.lg };
    expect(paletteIsLight(appWith({ id: "nord" }))).toBe(false);
    expect(paletteIsLight(appWith({ id: "x", light_theme: true }))).toBe(true);
    expect(paletteIsLight(appWith({ id: "x", light_theme: false }))).toBe(false);
  });

  it("writes the sheet for a palette and clears it for core Dark / Light and Own", () => {
    (globalThis as G).LiteGraph = { ...PALETTES.nord?.lg };
    expect(syncPalette(appWith({ id: "nord" }), "follow")).toBe(true);
    expect(document.documentElement.classList.contains("wp-palette-follow")).toBe(true);
    expect(document.getElementById("wp-comfy-palette")?.textContent).toContain("--wp-bg: #2e3440;");

    expect(syncPalette(appWith({ id: "dark" }), "follow")).toBe(false);
    expect(document.getElementById("wp-comfy-palette")).toBeNull();
    expect(document.documentElement.classList.contains("wp-palette-follow")).toBe(false);

    expect(syncPalette(appWith({ id: "nord" }), "own")).toBe(false);
    expect(document.getElementById("wp-comfy-palette")).toBeNull();
  });

  it("follows a palette switch and the setting", async () => {
    let palette = { id: "dark" };
    const app = { extensionManager: { colorPalette: { getActiveColorPalette: () => palette } } };
    (globalThis as G).LiteGraph = { ...PALETTES.dark?.lg };
    watchPalette(app);
    expect(document.getElementById("wp-comfy-palette")).toBeNull();

    palette = { id: "solarized" };
    (globalThis as G).LiteGraph = { ...PALETTES.solarized?.lg };
    document.documentElement.style.setProperty("--fg-color", "#fdf6e3");
    await Promise.resolve();
    expect(document.getElementById("wp-comfy-palette")?.textContent).toContain("--wp-bg: #002b36;");

    setCanvasColorsMode("own");
    expect(document.getElementById("wp-comfy-palette")).toBeNull();
    setCanvasColorsMode("follow");
    expect(document.getElementById("wp-comfy-palette")).not.toBeNull();
    document.documentElement.style.removeProperty("--fg-color");
  });

  it("never rewrites <html> when nothing changed (no observer loop)", async () => {
    (globalThis as G).LiteGraph = { ...PALETTES.dark?.lg };
    watchPalette(appWith({ id: "dark" }));
    let writes = 0;
    const spy = new MutationObserver((records) => {
      writes += records.length;
    });
    spy.observe(document.documentElement, { attributes: true });
    document.documentElement.style.setProperty("--fg-color", "#fff");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    spy.disconnect();
    // Only our own style write above; the sync itself touched nothing.
    expect(writes).toBe(1);
    document.documentElement.style.removeProperty("--fg-color");
  });
});
