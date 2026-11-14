/**
 * The manager's "ComfyUI palette" colour theme: the manager wears whichever
 * colour palette ComfyUI is using (Settings › Appearance › Color palette),
 * imported ones included, and switches when it does.
 *
 * Where the palette comes from, best first:
 *  1. An open canvas tab, over the `wp-comfy-palette` BroadcastChannel
 *     (`extension/comfy-palette.ts`): exactly what the canvas paints, Vue
 *     nodes and extension palettes (Easy-Use) included. We ask once on start.
 *  2. ComfyUI's own settings (`/api/settings`): `Comfy.ColorPalette` (the
 *     active id) looked up in `Comfy.CustomColorPalettes` or in the core
 *     palettes below. Read again whenever the manager tab comes back into
 *     view, so a switch made with no canvas open still lands.
 *
 * Core Dark and Light wear the Native theme (ComfyUI's own greys, hand-tuned);
 * any other palette is derived here with a contrast guard, written as one
 * sheet for `html.wp-manager[data-wp-palette="comfyui"]`. The palette also
 * decides dark or light. The accent stays ours unless the palette brings a
 * `primary` that reads (accent "Theme's own" only; a picked accent is inline
 * and wins anyway).
 *
 * Research: /pr-drafts/comfyui-palettes-research-2026-11-09.md (manager).
 */

import { ref } from "vue";
import {
  COMFY_PALETTE_CHANNEL,
  CORE_PALETTE_IDS,
  contrast,
  ensureContrast,
  isLightSurface,
  mix,
  resolveColor,
  toHex,
  type PaletteMessage,
  type Rgb,
} from "../../extension/comfy-palette";

/** The palette's colours we derive from. */
export interface ManagerPaletteBase {
  /** Node body: the manager's card surface. */
  node: Rgb;
  /** Widget fill. */
  surface: Rgb;
  text: Rgb;
  text2: Rgb;
}

export interface ComfyPaletteInfo {
  id: string;
  /** Whether the palette is light (flag, else its surfaces). */
  light: boolean;
  /** `null` for core Dark / Light, which wear Native. */
  base: ManagerPaletteBase | null;
  /** The palette's own accent, when it has one. */
  primary: Rgb | null;
}

// ── Reading a palette ─────────────────────────────────────────────────────

type ColorMap = Record<string, unknown>;

interface CorePalette {
  light?: boolean;
  /** litegraph_base keys, or theme keys for theme-only palettes. */
  lg?: ColorMap;
  theme?: ColorMap;
}

const DARK_LG: ColorMap = {
  NODE_DEFAULT_BGCOLOR: "#353535", WIDGET_BGCOLOR: "#222",
  WIDGET_TEXT_COLOR: "#DDD", WIDGET_SECONDARY_TEXT_COLOR: "#999",
};
const LIGHT_LG: ColorMap = {
  NODE_DEFAULT_BGCOLOR: "#F5F5F5", WIDGET_BGCOLOR: "#D4D4D4",
  WIDGET_TEXT_COLOR: "#222", WIDGET_SECONDARY_TEXT_COLOR: "#555",
};

/** ComfyUI's bundled palettes (frontend `src/assets/palettes`), the colours we read. */
export const CORE_PALETTES: Record<string, CorePalette> = {
  dark: { lg: DARK_LG },
  light: { light: true, lg: LIGHT_LG },
  solarized: { lg: { NODE_DEFAULT_BGCOLOR: "#073642", WIDGET_BGCOLOR: "#002b36", WIDGET_TEXT_COLOR: "#fdf6e3", WIDGET_SECONDARY_TEXT_COLOR: "#93a1a1" } },
  arc: { lg: { NODE_DEFAULT_BGCOLOR: "#242730", WIDGET_BGCOLOR: "#2b2f38", WIDGET_TEXT_COLOR: "#DDD", WIDGET_SECONDARY_TEXT_COLOR: "#b2b7bd" } },
  nord: { lg: { NODE_DEFAULT_BGCOLOR: "#161b22", WIDGET_BGCOLOR: "#2e3440", WIDGET_TEXT_COLOR: "#bcc2c8", WIDGET_SECONDARY_TEXT_COLOR: "#999" } },
  github: { lg: { NODE_DEFAULT_BGCOLOR: "#13171d", WIDGET_BGCOLOR: "#161b22", WIDGET_TEXT_COLOR: "#bcc2c8", WIDGET_SECONDARY_TEXT_COLOR: "#999" } },
  fennec: { theme: { node: "#1e1a27", input: "#15131c", foreground: "#f7e5bd", "muted-foreground": "#d4b48a", primary: "#2b5f9e" } },
  skeleton: { theme: { node: "#131418", input: "#121317", foreground: "#ece6d6", "muted-foreground": "#9d978a", primary: "#5d6b85" } },
  spooky: { theme: { node: "#140f19", input: "#140e1a", foreground: "#f4e9dc", "muted-foreground": "#a894b8", primary: "#e35d12" } },
  witch: { theme: { node: "#150f1e", input: "#120c1a", foreground: "#efe6f7", "muted-foreground": "#a99bbb", primary: "#2f8a3a" } },
  zombie: { theme: { node: "#121a12", input: "#0f160f", foreground: "#e3ecd6", "muted-foreground": "#93a387", primary: "#5e8a2c" } },
};

function asMap(v: unknown): ColorMap | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as ColorMap) : undefined;
}

/**
 * Read a palette as ComfyUI stores it (`{id, light_theme?, colors:
 * {litegraph_base?, theme?}}`), filling gaps from core Dark or Light the
 * way ComfyUI's `completePalette` does. Theme colours (newer frontends)
 * win over the legacy LiteGraph ones, as they do on Vue nodes.
 */
export function paletteInfo(id: string, raw: { light?: boolean; lg?: ColorMap; theme?: ColorMap }): ComfyPaletteInfo {
  const flag = raw.light === true;
  const fill = flag ? LIGHT_LG : DARK_LG;
  const lg = { ...fill, ...(raw.lg ?? {}) };
  const th = raw.theme ?? {};
  const pick = (themeKey: string, lgKey: string): Rgb | null =>
    resolveColor(th[themeKey]) ?? resolveColor(lg[lgKey]) ?? resolveColor(fill[lgKey]);
  const node = pick("node", "NODE_DEFAULT_BGCOLOR");
  const surface = pick("input", "WIDGET_BGCOLOR");
  const text = pick("foreground", "WIDGET_TEXT_COLOR");
  const text2 = pick("muted-foreground", "WIDGET_SECONDARY_TEXT_COLOR") ?? text;
  const primary = resolveColor(th.primary);
  if (CORE_PALETTE_IDS.has(id) || !node || !surface || !text || !text2) {
    return { id, light: flag, base: null, primary: null };
  }
  return { id, light: flag || isLightSurface(node), base: { node, surface, text, text2 }, primary };
}

/** The active palette from ComfyUI's `/api/settings` answer. `null` when
 *  the id names a palette we can't see (one an extension adds at run time). */
export function paletteFromSettings(all: Record<string, unknown>): ComfyPaletteInfo | null {
  const id = typeof all["Comfy.ColorPalette"] === "string" ? all["Comfy.ColorPalette"] : "dark";
  const custom = asMap(asMap(all["Comfy.CustomColorPalettes"])?.[id]);
  if (custom) {
    const colors = asMap(custom.colors);
    return paletteInfo(id, {
      light: custom.light_theme === true,
      lg: asMap(colors?.litegraph_base),
      theme: asMap(colors?.theme),
    });
  }
  const core = CORE_PALETTES[id];
  return core ? paletteInfo(id, core) : null;
}

/** What an open canvas tab reported. */
export function paletteFromMessage(msg: unknown): ComfyPaletteInfo | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Partial<PaletteMessage>;
  if (m.type !== "palette" || !m.base || typeof m.base !== "object") return null;
  const id = typeof m.id === "string" ? m.id : "";
  const node = resolveColor(m.base.node);
  const surface = resolveColor(m.base.surface);
  const text = resolveColor(m.base.text);
  const text2 = resolveColor(m.base.text2) ?? text;
  const light = m.light === true;
  if (CORE_PALETTE_IDS.has(id) || !node || !surface || !text || !text2) {
    return { id, light, base: null, primary: null };
  }
  return { id, light, base: { node, surface, text, text2 }, primary: resolveColor(m.primary) };
}

// ── Deriving the manager's tokens ─────────────────────────────────────────

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const HEX = toHex;
/** kit tokens.css `--wp-bundle-default` (slate-500 dark, slate-700 light). */
const BUNDLE_DARK: Rgb = { r: 0x64, g: 0x74, b: 0x8b };
const BUNDLE_LIGHT: Rgb = { r: 0x33, g: 0x41, b: 0x55 };

/**
 * The manager's surface ramp, borders and text tiers from a palette.
 * Dark: the node colour is the card (`--wp-bg-2`), the page sits under it,
 * raised surfaces step toward the text. Light: cards go toward white,
 * the page and wells step toward the text. Every text tier keeps 4.5:1
 * on page … bg-3 (main text 7:1), pushed toward black or white when the
 * palette's own colour doesn't.
 */
export function deriveManagerTokens(base: ManagerPaletteBase, light: boolean): Record<string, string> {
  const { node } = base;
  const far = light ? BLACK : WHITE;
  let page: Rgb, bg1: Rgb, bg2: Rgb, bg3: Rgb, bg4: Rgb;
  if (light) {
    page = mix(node, base.text, 0.04);
    bg1 = mix(node, WHITE, 0.6);
    bg2 = bg1;
    bg3 = mix(node, base.text, 0.08);
    bg4 = mix(node, base.text, 0.15);
  } else {
    page = mix(node, BLACK, 0.3);
    bg1 = mix(node, BLACK, 0.12);
    bg2 = node;
    bg3 = mix(node, base.text, 0.08);
    bg4 = mix(node, base.text, 0.14);
  }
  // Text must read on the whole ramp: check against the closest-to-text surface.
  const nearest = [page, bg1, bg2, bg3].reduce((a, b) => (contrast(base.text, a) < contrast(base.text, b) ? a : b));
  const text = ensureContrast(base.text, nearest, 7, far);
  const muted = ensureContrast(base.text2, nearest, 4.5, far);
  const dim = ensureContrast(mix(base.text2, page, 0.12), nearest, 4.5, far);
  // Bundles' slate is the one fixed colour dark enough to sink into a
  // mid-tone palette (a teal node): lift it toward the text when it would.
  const bundle = ensureContrast(light ? BUNDLE_LIGHT : BUNDLE_DARK, bg3, 4.5, text);
  const border = mix(bg1, text, light ? 0.12 : 0.09);
  const borderStrong = mix(bg1, text, light ? 0.22 : 0.17);
  return {
    "--wp-bg": HEX(page),
    "--wp-bg-1": HEX(bg1),
    "--wp-bg-2": HEX(bg2),
    "--wp-bg-3": HEX(bg3),
    "--wp-bg-4": HEX(bg4),
    "--wp-border": HEX(border),
    "--wp-border-strong": HEX(borderStrong),
    "--wp-text": HEX(text),
    "--wp-text-muted": HEX(muted),
    "--wp-text-dim": HEX(dim),
    "--wp-bundle-default": HEX(bundle),
  };
}

/** An accent ramp from the palette's `primary`, or `null` when it wouldn't
 *  read: the primary fill (600) must carry white text at 4.5:1 and the
 *  accent text (300 dark / 700 light) must read on the page. */
export function primaryRamp(
  primary: Rgb | null,
  tokens: Record<string, string>,
  light: boolean,
  rampFromHex: (hex: string) => Record<string, string>,
): Record<string, string> | null {
  if (!primary) return null;
  const ramp = rampFromHex(toHex(primary));
  const fill = resolveColor(ramp["--wp-accent-600"]);
  const accentText = resolveColor(ramp[light ? "--wp-accent-700" : "--wp-accent-300"]);
  const page = resolveColor(tokens["--wp-bg"]);
  if (!fill || !accentText || !page) return null;
  if (contrast(fill, WHITE) < 4.5 || contrast(accentText, page) < 4.5) return null;
  return ramp;
}

export const MANAGER_PALETTE_SELECTOR = 'html.wp-manager[data-wp-palette="comfyui"]';

export function managerSheet(tokens: Record<string, string>, ramp: Record<string, string> | null): string {
  const lines = Object.entries({ ...tokens, ...(ramp ?? {}) }).map(([k, v]) => `  ${k}: ${v};`);
  return `${MANAGER_PALETTE_SELECTOR} {\n${lines.join("\n")}\n}\n`;
}

// ── Live state ────────────────────────────────────────────────────────────

const STYLE_ID = "wp-manager-comfy-palette";

/** The palette in use (`null` until read, or when it can't be). */
export const comfyPalette = ref<ComfyPaletteInfo | null>(null);

let fromCanvas: ComfyPaletteInfo | null = null;
let fromSettings: ComfyPaletteInfo | null = null;
let settingsId: string | undefined;
let channel: BroadcastChannel | null = null;
let onVisible: (() => void) | null = null;
let running = false;

function choose(): void {
  // The canvas's reading wins while it describes the palette ComfyUI saved
  // (it sees Vue nodes and extension palettes); the settings win once they
  // name another one (switched while no canvas was open).
  const canvasCurrent = fromCanvas && (settingsId === undefined || fromCanvas.id === settingsId || !fromSettings);
  comfyPalette.value = canvasCurrent ? fromCanvas : fromSettings;
}

export async function refreshFromSettings(): Promise<void> {
  try {
    const resp = await fetch("/api/settings");
    if (!resp.ok) return;
    const all = await resp.json() as Record<string, unknown>;
    settingsId = typeof all["Comfy.ColorPalette"] === "string" ? all["Comfy.ColorPalette"] : "dark";
    fromSettings = paletteFromSettings(all);
  } catch {
    return;
  }
  if (running) choose();
}

/** Start following ComfyUI's palette. Idempotent. */
export function startComfyPalette(): void {
  if (running) return;
  running = true;
  void refreshFromSettings();
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(COMFY_PALETTE_CHANNEL);
      channel.onmessage = (e: MessageEvent<unknown>) => {
        const info = paletteFromMessage(e.data);
        if (!info) return;
        fromCanvas = info;
        if (info.id) settingsId = info.id;
        choose();
      };
      channel.postMessage({ type: "ask" });
    } catch {
      channel = null;
    }
  }
  if (typeof document !== "undefined") {
    onVisible = () => {
      if (document.visibilityState === "visible") void refreshFromSettings();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  }
}

export function stopComfyPalette(): void {
  running = false;
  channel?.close();
  channel = null;
  if (onVisible) {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    onVisible = null;
  }
  comfyPalette.value = null;
  writeManagerSheet("");
}

export function writeManagerSheet(css: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID);
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Tests only. */
export function _resetComfyPaletteForTests(): void {
  stopComfyPalette();
  fromCanvas = null;
  fromSettings = null;
  settingsId = undefined;
}
