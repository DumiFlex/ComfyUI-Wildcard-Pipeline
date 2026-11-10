import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { contrast, parseColor, type Rgb } from "../../extension/comfy-palette";
import {
  CORE_PALETTES,
  _resetComfyPaletteForTests,
  comfyPalette,
  deriveManagerTokens,
  managerSheet,
  paletteFromMessage,
  paletteFromSettings,
  paletteInfo,
  primaryRamp,
  refreshFromSettings,
} from "../utils/comfy-palette-theme";
import { paletteFromHex, useTweaksStore } from "../stores/tweaksStore";
import { useUiStore } from "../stores/uiStore";

function must(hex: string | undefined): Rgb {
  const c = parseColor(hex ?? "");
  if (!c) throw new Error(`bad colour ${hex}`);
  return c;
}

const MILK_WHITE = {
  colors: {
    litegraph_base: {
      NODE_DEFAULT_BGCOLOR: "#F5F5F5", WIDGET_BGCOLOR: "#D4D4D4",
      WIDGET_TEXT_COLOR: "#222", WIDGET_SECONDARY_TEXT_COLOR: "#555",
    },
  },
};

function settings(id: string, custom: Record<string, unknown> = {}): Record<string, unknown> {
  return { "Comfy.ColorPalette": id, "Comfy.CustomColorPalettes": custom };
}

function mockSettings(all: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => all })));
}

afterEach(() => {
  _resetComfyPaletteForTests();
  vi.unstubAllGlobals();
});

describe("reading ComfyUI's palette", () => {
  it("core Dark and Light wear Native (no derived colours)", () => {
    expect(paletteFromSettings(settings("dark"))).toMatchObject({ id: "dark", light: false, base: null });
    expect(paletteFromSettings(settings("light"))).toMatchObject({ id: "light", light: true, base: null });
    // No palette saved yet = ComfyUI's default, Dark.
    expect(paletteFromSettings({})).toMatchObject({ id: "dark", base: null });
  });

  it("reads bundled palettes, legacy and theme-only", () => {
    const nord = paletteFromSettings(settings("nord"));
    expect(nord?.light).toBe(false);
    expect(nord?.base?.node).toEqual(must("#161b22"));
    const spooky = paletteFromSettings(settings("spooky"));
    expect(spooky?.base?.surface).toEqual(must("#140e1a"));
    expect(spooky?.primary).toEqual(must("#e35d12"));
  });

  it("reads an imported palette, fills its gaps and spots a light one with no flag", () => {
    const milk = paletteFromSettings(settings("milk_white", { milk_white: { id: "milk_white", ...MILK_WHITE } }));
    expect(milk?.light).toBe(true);
    expect(milk?.base?.text).toEqual(must("#222222"));
    const partial = paletteFromSettings(settings("mine", {
      mine: { id: "mine", colors: { litegraph_base: { NODE_DEFAULT_BGCOLOR: "#0f3d3e" } } },
    }));
    expect(partial?.base?.node).toEqual(must("#0f3d3e"));
    expect(partial?.base?.text).toEqual(must("#dddddd")); // from core Dark
  });

  it("theme colours win over LiteGraph ones, as on Vue nodes", () => {
    const info = paletteInfo("x", { lg: { NODE_DEFAULT_BGCOLOR: "#111111" }, theme: { node: "#223344" } });
    expect(info.base?.node).toEqual(must("#223344"));
  });

  it("an id it can't see (added by an extension at run time) is null", () => {
    expect(paletteFromSettings(settings("easy_obsidian"))).toBeNull();
  });

  it("reads what an open canvas tab reports", () => {
    const info = paletteFromMessage({
      type: "palette", id: "easy_obsidian", light: false, primary: undefined,
      base: { surface: "#1b1b1f", node: "#232329", text: "#e0e0e0", text2: "#9a9a9a", canvas: "#121214" },
    });
    expect(info?.base?.node).toEqual(must("#232329"));
    expect(paletteFromMessage({ type: "palette", id: "dark", light: false, base: { surface: "#222", node: "#353535", text: "#ddd", text2: "#999", canvas: "#141414" } })?.base).toBeNull();
    expect(paletteFromMessage({ type: "ask" })).toBeNull();
    expect(paletteFromMessage("nope")).toBeNull();
  });
});

describe("deriving the manager's colours", () => {
  const cases: Array<[string, ReturnType<typeof paletteFromSettings>]> = [
    ...Object.keys(CORE_PALETTES).filter((id) => id !== "dark" && id !== "light")
      .map((id): [string, ReturnType<typeof paletteFromSettings>] => [id, paletteFromSettings(settings(id))]),
    ["teal", paletteInfo("teal", { lg: { NODE_DEFAULT_BGCOLOR: "#0f3d3e", WIDGET_BGCOLOR: "#0b2e2f", WIDGET_TEXT_COLOR: "#d8f3ef", WIDGET_SECONDARY_TEXT_COLOR: "#8fbfb8" } })],
    ["milk_white", paletteFromSettings(settings("milk_white", { milk_white: MILK_WHITE }))],
    ["bad text", paletteInfo("bad", { lg: { NODE_DEFAULT_BGCOLOR: "#335533", WIDGET_TEXT_COLOR: "#3a5a3a", WIDGET_SECONDARY_TEXT_COLOR: "#335533" } })],
  ];

  it.each(cases)("%s: every text tier reads on page … bg-3", (_id, info) => {
    const base = info?.base;
    if (!base || !info) throw new Error("no base");
    const t = deriveManagerTokens(base, info.light);
    for (const surface of ["--wp-bg", "--wp-bg-1", "--wp-bg-2", "--wp-bg-3"]) {
      const bg = must(t[surface]);
      expect(contrast(must(t["--wp-text"]), bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(must(t["--wp-text-muted"]), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(must(t["--wp-text-dim"]), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(must(t["--wp-bundle-default"]), must(t["--wp-bg-3"]))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the node colour as the card in dark palettes, under a darker page", () => {
    const nord = paletteFromSettings(settings("nord"));
    if (!nord?.base) throw new Error("no base");
    const t = deriveManagerTokens(nord.base, false);
    expect(t["--wp-bg-2"]).toBe("#161b22");
    expect(contrast(must(t["--wp-bg"]), must("#000000"))).toBeLessThan(contrast(must(t["--wp-bg-2"]), must("#000000")));
  });

  it("uses the palette's primary only when it reads", () => {
    const spooky = paletteFromSettings(settings("spooky"));
    if (!spooky?.base) throw new Error("no base");
    const tokens = deriveManagerTokens(spooky.base, false);
    // A ramp comes back only when its 600 fill carries white text.
    const ramp = primaryRamp(spooky.primary, tokens, false, paletteFromHex);
    if (ramp) expect(contrast(must(ramp["--wp-accent-600"]), must("#ffffff"))).toBeGreaterThanOrEqual(4.5);
    // A pale yellow can't carry white text: keep our accent.
    expect(primaryRamp(must("#fff59d"), tokens, false, paletteFromHex)).toBeNull();
    expect(primaryRamp(null, tokens, false, paletteFromHex)).toBeNull();
    // A deep blue can.
    expect(primaryRamp(must("#2b5f9e"), tokens, false, paletteFromHex)).not.toBeNull();
  });

  it("writes one sheet for the comfyui theme", () => {
    const css = managerSheet({ "--wp-bg": "#000000" }, { "--wp-accent-600": "#123456" });
    expect(css).toContain('html.wp-manager[data-wp-palette="comfyui"]');
    expect(css).toContain("--wp-bg: #000000;");
    expect(css).toContain("--wp-accent-600: #123456;");
  });
});

describe("the ComfyUI palette colour theme", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const root = document.documentElement;
    root.style.cssText = "";
    root.className = "wp-manager";
    root.removeAttribute("data-wp-palette");
    localStorage.clear();
  });

  // Each test's store watches the one shared palette ref: leave it off the
  // ComfyUI theme so it can't answer the next test's changes.
  afterEach(() => {
    useTweaksStore().setPalette("orbit");
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await nextTick();
  }

  it("wears Native on core Dark and lets the palette pick the scheme", async () => {
    mockSettings(settings("light"));
    const tweaks = useTweaksStore();
    const ui = useUiStore();
    ui.initializeTheme();
    tweaks.setPalette("comfyui");
    await settle();
    expect(comfyPalette.value?.id).toBe("light");
    expect(document.documentElement.getAttribute("data-wp-palette")).toBe("native");
    expect(ui.resolvedTheme).toBe("light");
    expect(document.getElementById("wp-manager-comfy-palette")).toBeNull();
  });

  it("derives a sheet for other palettes, follows a switch, and lets go when another theme is picked", async () => {
    mockSettings(settings("nord"));
    const tweaks = useTweaksStore();
    const ui = useUiStore();
    tweaks.setPalette("comfyui");
    await settle();
    const root = document.documentElement;
    expect(root.getAttribute("data-wp-palette")).toBe("comfyui");
    expect(ui.resolvedTheme).toBe("dark");
    expect(document.getElementById("wp-manager-comfy-palette")?.textContent).toContain("--wp-bg-2: #161b22;");
    expect(tweaks.swatchFor("comfyui", "dark")?.[1]).toBe("#161b22");

    mockSettings(settings("milk_white", { milk_white: MILK_WHITE }));
    await refreshFromSettings();
    await settle();
    expect(ui.resolvedTheme).toBe("light");

    tweaks.setPalette("tide");
    await settle();
    expect(root.getAttribute("data-wp-palette")).toBe("tide");
    expect(ui.schemeOverride).toBeNull();
    expect(document.getElementById("wp-manager-comfy-palette")).toBeNull();
  });

  it("an open canvas's reading wins while it names the saved palette", async () => {
    const box: { onmessage: ((e: MessageEvent<unknown>) => void) | null } = { onmessage: null };
    const posted: unknown[] = [];
    class FakeChannel {
      set onmessage(fn: ((e: MessageEvent<unknown>) => void) | null) { box.onmessage = fn; }
      postMessage(m: unknown): void { posted.push(m); }
      close(): void { /* nothing */ }
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    mockSettings(settings("easy_obsidian"));
    const tweaks = useTweaksStore();
    tweaks.setPalette("comfyui");
    await settle();
    expect(posted).toContainEqual({ type: "ask" });
    expect(comfyPalette.value).toBeNull(); // the settings alone can't see it
    box.onmessage?.({ data: {
      type: "palette", id: "easy_obsidian", light: false, primary: undefined,
      base: { surface: "#1b1b1f", node: "#232329", text: "#e0e0e0", text2: "#9a9a9a", canvas: "#121214" },
    } } as MessageEvent<unknown>);
    await settle();
    expect(comfyPalette.value?.id).toBe("easy_obsidian");
    expect(document.documentElement.getAttribute("data-wp-palette")).toBe("comfyui");
  });
});
