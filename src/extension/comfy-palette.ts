/**
 * Follow ComfyUI's colour palette on the canvas.
 *
 * ComfyUI palettes (core Solarized / Arc / Nord / Github, ones extensions
 * ship such as Easy-Use's Obsidian or Milk White, and any the user imports)
 * are full colour sets, not just "dark" or "light". The canvas paints node
 * bodies and widgets from them; our widgets used to keep one of our two
 * hand-tuned sets, so their rows stayed grey on a teal or blue node.
 *
 * This module reads a few base colours from whatever ComfyUI is painting
 * (see `readPaletteBase`), derives our surface / border / text ramp from them
 * with a contrast guard (`derivePaletteTokens`), and writes the result as one
 * small sheet. Core Dark and Light keep the hand-tuned sets in `theme.css`,
 * and so does everyone who sets Wildcard Pipeline › Sizing › Canvas colors to
 * our own colours. Accent, kind, variable and status colours stay ours: the
 * light/dark class from `theme-detector.ts` picks their set, using
 * `paletteIsLight` below so a light palette without `light_theme` (Milk
 * White) still counts as light.
 *
 * Research: /pr-drafts/comfyui-palettes-research-2026-11-09.md.
 */

import { isVueNodes } from "./renderer";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The colours we derive from, as ComfyUI paints them. */
export interface PaletteBase {
  /** Widget fill (`WIDGET_BGCOLOR` / `--input`): our row and card surface. */
  surface: Rgb;
  /** Node body (`NODE_DEFAULT_BGCOLOR` / `--node`). */
  node: Rgb;
  /** Widget text (`WIDGET_TEXT_COLOR`). */
  text: Rgb;
  /** Secondary widget text (`WIDGET_SECONDARY_TEXT_COLOR`). */
  text2: Rgb;
  /** Canvas behind the nodes (`CLEAR_BACKGROUND_COLOR`). */
  canvas: Rgb;
}

export interface PaletteReading {
  /** Active palette id, when the frontend says. */
  id: string | undefined;
  /** The palette's `light_theme` flag (`undefined` when not set). */
  lightFlag: boolean | undefined;
  base: PaletteBase | null;
}

export type CanvasColorsMode = "follow" | "own";

/** Palettes our hand-tuned sets are made for: never derived. */
export const CORE_PALETTE_IDS: ReadonlySet<string> = new Set(["dark", "light"]);

const STYLE_ID = "wp-comfy-palette";
const FOLLOW_CLASS = "wp-palette-follow";

// ── Colour maths ──────────────────────────────────────────────────────────

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Parse the colour strings browsers and palettes produce: `#rgb`, `#rgba`,
 *  `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` (comma or space syntax) and
 *  `color(srgb r g b)`. Alpha is dropped. `null` for anything else. */
export function parseColor(value: string): Rgb | null {
  const s = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1] ?? "";
    if (h.length === 3 || h.length === 4) {
      const [r, g, b] = [h[0], h[1], h[2]].map((c) => parseInt(`${c}${c}`, 16));
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }
  const rgb = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(s);
  if (rgb) {
    return { r: clamp255(Number(rgb[1])), g: clamp255(Number(rgb[2])), b: clamp255(Number(rgb[3])) };
  }
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s);
  if (srgb) {
    return {
      r: clamp255(Number(srgb[1]) * 255),
      g: clamp255(Number(srgb[2]) * 255),
      b: clamp255(Number(srgb[3]) * 255),
    };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => clamp255(n).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved `t` (0..1) of the way to `b`, in sRGB. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: clamp255(a.r + (b.r - a.r) * t),
    g: clamp255(a.g + (b.g - a.g) * t),
    b: clamp255(a.b + (b.b - a.b) * t),
  };
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 .. 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lighter than this reads as a light surface (mid grey #777 is ~0.18). */
const LIGHT_SURFACE = 0.4;

export function isLightSurface(c: Rgb): boolean {
  return luminance(c) > LIGHT_SURFACE;
}

/** Move `fg` toward `toward` in small steps until it reaches `min` contrast
 *  on `bg` (or `toward` itself). */
function ensureContrast(fg: Rgb, bg: Rgb, min: number, toward: Rgb): Rgb {
  let c = fg;
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) {
    c = mix(c, toward, 0.15);
  }
  return contrast(c, bg) < min ? toward : c;
}

// ── Derivation ────────────────────────────────────────────────────────────

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** Our own text colours, used when a palette's text doesn't read. */
const OWN_TEXT_DARK = parseColor("#dddddd") ?? WHITE;
const OWN_TEXT_LIGHT = parseColor("#1a1a1a") ?? BLACK;

/** The indigo accent ramp (theme.css). Accent text takes the first step,
 *  in this order, that reads on the surface. */
const ACCENT_TEXT_ON_DARK = ["#a5b4fc", "#c7d2fe", "#e0e7ff"];
const ACCENT_TEXT_ON_LIGHT = ["#4338ca", "#3730a3", "#312e81"];

/**
 * Our canvas tokens for a palette. Pure: `base` in, `--wp-*` values out.
 *
 * Steps are calibrated so ComfyUI's core Dark derives within a few levels of
 * the hand-tuned dark set (bg #222/#262626/#2b2b2b/#333, borders #3a3a3a /
 * #474747, text3 #636363, text4 #898989).
 */
export function derivePaletteTokens(base: PaletteBase, light: boolean): Record<string, string> {
  const bg = base.surface;
  const ownText = light ? OWN_TEXT_LIGHT : OWN_TEXT_DARK;
  const extreme = light ? BLACK : WHITE;

  // Text must read well on the surface: else our own text colour.
  const text = contrast(base.text, bg) >= 7 ? base.text : ensureContrast(ownText, bg, 7, extreme);
  const text2 = ensureContrast(base.text2, bg, 4.5, text);
  const toText = (t: number) => mix(bg, text, t);
  const text3 = ensureContrast(toText(0.35), bg, 2.5, text);
  const text4 = ensureContrast(toText(0.55), bg, 3.5, text);

  const accentSteps = (light ? ACCENT_TEXT_ON_LIGHT : ACCENT_TEXT_ON_DARK)
    .map((h) => parseColor(h))
    .filter((c): c is Rgb => c !== null);
  const accentText = accentSteps.find((c) => contrast(c, bg) >= 4.5) ?? text;
  const accentStrong = accentSteps.find((c) => c !== accentText && contrast(c, bg) >= contrast(accentText, bg)) ?? accentText;

  const nodeText = ensureContrast(base.text, base.node, 4.5, extreme);

  const t = {
    bg: toHex(bg),
    bg2: toHex(toText(0.02)),
    bg3: toHex(toText(0.05)),
    bg4: toHex(toText(0.09)),
    deep: toHex(mix(bg, BLACK, 0.1)),
    border: toHex(toText(0.13)),
    borderSoft: toHex(toText(0.16)),
    border2: toHex(toText(0.2)),
    text: toHex(text),
    text2: toHex(text2),
    text3: toHex(text3),
    text4: toHex(text4),
  };

  return {
    "--wp-bg": t.bg,
    "--wp-bg2": t.bg2,
    "--wp-bg3": t.bg3,
    "--wp-bg4": t.bg4,
    "--wp-bg-1": t.bg,
    "--wp-bg-2": t.bg2,
    "--wp-bg-3": t.bg3,
    "--wp-bg-4": t.bg4,
    "--wp-bg-deep": t.deep,
    "--wp-border": t.border,
    "--wp-border-soft": t.borderSoft,
    "--wp-border2": t.border2,
    "--wp-border-strong": t.border2,
    "--wp-text": t.text,
    "--wp-text2": t.text2,
    "--wp-text3": t.text3,
    "--wp-text4": t.text4,
    "--wp-text-muted": t.text2,
    "--wp-text-dim": t.text3,
    "--wp-accent-text": toHex(accentText),
    "--wp-accent-text-strong": toHex(accentStrong),
    "--wp-canvas-bg": toHex(base.canvas),
    "--wp-node-bg": toHex(base.node),
    "--wp-node-bg-2": toHex(mix(base.node, bg, 0.5)),
    "--wp-node-bg-3": toHex(mix(base.node, bg, 0.35)),
    "--wp-node-border": toHex(mix(base.node, BLACK, light ? 0.35 : 0.5)),
    "--wp-node-text": toHex(nodeText),
    "--wp-node-text-2": t.text2,
  };
}

/** The sheet text for a token set. Hosts carry `wp-theme-dark` /
 *  `wp-theme-light`, which redeclare tokens, so the rule reaches them too;
 *  the host part skips High contrast (on `<body>`), which keeps winning. */
export function paletteSheet(tokens: Record<string, string>): string {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return (
    `:root.${FOLLOW_CLASS}:not(.wp-manager),\n` +
    `:root.${FOLLOW_CLASS} body:not(.wp-a11y-high-contrast) :is(.wp-theme-dark, .wp-theme-light, .wp-canvas-scope) {\n` +
    `${body}\n}\n`
  );
}

// ── Reading what ComfyUI paints ───────────────────────────────────────────

interface LiteGraphColors {
  NODE_DEFAULT_BGCOLOR?: unknown;
  WIDGET_BGCOLOR?: unknown;
  WIDGET_TEXT_COLOR?: unknown;
  WIDGET_SECONDARY_TEXT_COLOR?: unknown;
  CLEAR_BACKGROUND_COLOR?: unknown;
}

interface PaletteLike {
  id?: unknown;
  light_theme?: unknown;
  colors?: { litegraph_base?: LiteGraphColors };
}

interface AppLike {
  extensionManager?: unknown;
}

let probe: HTMLElement | null = null;

/** Resolve any CSS colour (`var(…)`, `color-mix(…)`, `lightgray`, short hex)
 *  to RGB through a hidden probe element. Plain hex / rgb skip the DOM. */
export function resolveColor(value: unknown): Rgb | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = parseColor(value);
  if (direct) return direct;
  if (typeof document === "undefined" || !document.body) return null;
  try {
    if (!probe || !probe.isConnected) {
      probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
      document.body.appendChild(probe);
    }
    probe.style.color = "";
    probe.style.color = value;
    if (!probe.style.color) return null;
    return parseColor(getComputedStyle(probe).color);
  } catch {
    return null;
  }
}

function activePalette(app?: AppLike): PaletteLike | undefined {
  const em = app?.extensionManager;
  if (!em || typeof em !== "object" || !("colorPalette" in em)) return undefined;
  const cp: unknown = em.colorPalette;
  if (!cp || typeof cp !== "object" || !("getActiveColorPalette" in cp)) return undefined;
  const get: unknown = cp.getActiveColorPalette;
  if (typeof get !== "function") return undefined;
  try {
    const p: unknown = get.call(cp);
    return p && typeof p === "object" ? (p as PaletteLike) : undefined;
  } catch {
    return undefined;
  }
}

/** A CSS variable on `<html>`, resolved; `null` when the frontend has none. */
function cssVar(...names: string[]): Rgb | null {
  if (typeof document === "undefined" || !document.documentElement) return null;
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(document.documentElement);
  } catch {
    return null;
  }
  for (const n of names) {
    const raw = style.getPropertyValue(n).trim();
    if (raw) {
      const c = resolveColor(raw);
      if (c) return c;
    }
  }
  return null;
}

/**
 * The base colours ComfyUI is painting right now, in this order:
 *  1. Vue nodes (Nodes 2.0): the node and widget fills Vue nodes use
 *     (`--component-node-*`, newer frontends `--node` / `--input`).
 *  2. The `LiteGraph` globals the classic canvas draws from (every frontend
 *     sets them, and so do extensions that load palettes themselves).
 *  3. The active palette object.
 */
export function readPaletteBase(app?: AppLike): PaletteReading {
  const palette = activePalette(app);
  const id = typeof palette?.id === "string" ? palette.id : undefined;
  const lightFlag = typeof palette?.light_theme === "boolean" ? palette.light_theme : undefined;
  const lg = (globalThis as { LiteGraph?: LiteGraphColors }).LiteGraph;
  const pl = palette?.colors?.litegraph_base;
  const pick = (key: keyof LiteGraphColors): Rgb | null => resolveColor(lg?.[key]) ?? resolveColor(pl?.[key]);

  let surface = pick("WIDGET_BGCOLOR");
  let node = pick("NODE_DEFAULT_BGCOLOR");
  if (isVueNodes()) {
    surface = cssVar("--component-node-widget-background", "--input") ?? surface;
    node = cssVar("--component-node-background", "--node") ?? node;
  }
  const text = pick("WIDGET_TEXT_COLOR");
  const text2 = pick("WIDGET_SECONDARY_TEXT_COLOR") ?? text;
  const canvas = pick("CLEAR_BACKGROUND_COLOR") ?? node;
  if (!surface || !node || !text || !text2 || !canvas) return { id, lightFlag, base: null };
  return { id, lightFlag, base: { surface, node, text, text2, canvas } };
}

/**
 * Whether ComfyUI's palette is light: the `light_theme` flag, else the
 * lightness of what it paints (Easy-Use's Milk White is white but sets no
 * flag). `undefined` when there is nothing to read.
 */
export function paletteIsLight(app?: AppLike): boolean | undefined {
  const r = readPaletteBase(app);
  if (r.lightFlag === true) return true;
  if (r.base) return isLightSurface(r.base.surface);
  if (r.lightFlag === false || r.id !== undefined) return false;
  return undefined;
}

// ── Applying ──────────────────────────────────────────────────────────────

let lastSheet = "";

function setSheet(css: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  let el = document.getElementById(STYLE_ID);
  // Touch the class only when it changes: even a no-op classList call
  // rewrites the attribute, which re-fires the observer on <html> below.
  if (!css) {
    if (root?.classList.contains(FOLLOW_CLASS)) root.classList.remove(FOLLOW_CLASS);
    el?.remove();
    lastSheet = "";
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (css !== lastSheet || el.textContent !== css) {
    el.textContent = css;
    lastSheet = css;
  }
  if (!root?.classList.contains(FOLLOW_CLASS)) root?.classList.add(FOLLOW_CLASS);
}

/**
 * Derive and apply (or clear) the palette sheet. Returns whether palette
 * colours are now in use. Core Dark / Light, mode `own`, or a palette we
 * can't read all clear it.
 */
export function syncPalette(app: AppLike | undefined, mode: CanvasColorsMode): boolean {
  const r = readPaletteBase(app);
  if (mode !== "follow" || !r.base || (r.id !== undefined && CORE_PALETTE_IDS.has(r.id))) {
    setSheet("");
    return false;
  }
  const light = r.lightFlag === true || isLightSurface(r.base.surface);
  setSheet(paletteSheet(derivePaletteTokens(r.base, light)));
  return true;
}

let watching: MutationObserver | null = null;
let currentMode: CanvasColorsMode = "follow";
let currentApp: AppLike | undefined;

/** The mode the canvas colours run in (Wildcard Pipeline › Sizing › Canvas colors). */
export function setCanvasColorsMode(mode: CanvasColorsMode): void {
  currentMode = mode;
  syncPalette(currentApp, currentMode);
}

/**
 * Keep the sheet in step with ComfyUI: one observer on `<html>` (ComfyUI
 * rewrites its inline style and/or class on every palette switch). Safe to
 * call more than once; later calls just re-sync.
 */
export function watchPalette(app: AppLike | undefined): void {
  currentApp = app;
  syncPalette(currentApp, currentMode);
  if (watching || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  watching = new MutationObserver(() => {
    syncPalette(currentApp, currentMode);
  });
  watching.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
}

/** Tests only. */
export function _resetPaletteForTests(): void {
  watching?.disconnect();
  watching = null;
  currentMode = "follow";
  currentApp = undefined;
  lastSheet = "";
  probe = null;
  if (typeof document !== "undefined") {
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement?.classList.remove(FOLLOW_CLASS);
  }
}
