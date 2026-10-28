import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useUiStore, type DensityMode } from "./uiStore";

/**
 * Runtime tweaks store — colour theme, look, accent palette and sidebar mode. Density is a
 * pass-through to the ui store so the panel and Settings share one value.
 *
 * Lets the user A/B different look-and-feel options without rebuilding.
 * Overrides apply via inline CSS variables on `<html>` and persist to
 * `localStorage` under `wp-tweaks-v1`.
 *
 * Mirror of the prototype's `tweaks-panel.jsx` host protocol — without the
 * postMessage iframe dance, since we own the document directly.
 */

/** A preset accent ramp. */
export type PresetAccent = "violet" | "indigo" | "teal" | "rose" | "amber";
/** `"theme"` = the colour theme's own accent (no inline override). */
export type AccentName  = PresetAccent | "theme" | "custom";
/** Colour theme: surfaces, borders, text and a default accent. `data-wp-palette`
 *  on <html>; the rules live in styles/themes.css. */
export type PaletteName = "orbit" | "native" | "nebula" | "tide" | "ember" | "contrast";
/** Look: everything that is not colour (shape, type, borders, depth).
 *  `data-wp-look` on <html>; the rules live in styles/looks.css. */
export type LookName    = "orbit" | "crisp" | "soft" | "terminal" | "editorial" | "compact" | "tui";
export type Density     = DensityMode;
export type SidebarMode = "expanded" | "collapsed";

const STORAGE_KEY = "wp-tweaks-v1";

/** Accent palette presets — full 50→900 scale from prototype `tweaks-panel.jsx`.
 *  The prototype only persists the 300–700 stops (since the mid-range is what
 *  surfaces in tinted backgrounds, gradients, and focus rings) but we override
 *  the whole scale so cross-theme consistency holds.
 *
 *  The "custom" key intentionally points at a placeholder palette; the actual
 *  palette is generated from the user's hex via `paletteFromHex()` below. */
export const ACCENT_PALETTES: Record<PresetAccent, Record<string, string>> = {
  violet: {
    "--wp-accent-50":  "#f5f3ff",
    "--wp-accent-100": "#ede9fe",
    "--wp-accent-200": "#ddd6fe",
    "--wp-accent-300": "#c4b5fd",
    "--wp-accent-400": "#a78bfa",
    "--wp-accent-500": "#8b5cf6",
    "--wp-accent-600": "#7c3aed",
    "--wp-accent-700": "#6d28d9",
    "--wp-accent-800": "#5b21b6",
    "--wp-accent-900": "#4c1d95",
  },
  indigo: {
    "--wp-accent-50":  "#eef2ff",
    "--wp-accent-100": "#e0e7ff",
    "--wp-accent-200": "#c7d2fe",
    "--wp-accent-300": "#a5b4fc",
    "--wp-accent-400": "#818cf8",
    "--wp-accent-500": "#6366f1",
    "--wp-accent-600": "#4f46e5",
    "--wp-accent-700": "#4338ca",
    "--wp-accent-800": "#3730a3",
    "--wp-accent-900": "#312e81",
  },
  teal: {
    "--wp-accent-50":  "#f0fdfa",
    "--wp-accent-100": "#ccfbf1",
    "--wp-accent-200": "#99f6e4",
    "--wp-accent-300": "#5eead4",
    "--wp-accent-400": "#2dd4bf",
    "--wp-accent-500": "#14b8a6",
    "--wp-accent-600": "#0d9488",
    "--wp-accent-700": "#0f766e",
    "--wp-accent-800": "#115e59",
    "--wp-accent-900": "#134e4a",
  },
  rose: {
    "--wp-accent-50":  "#fff1f2",
    "--wp-accent-100": "#ffe4e6",
    "--wp-accent-200": "#fecdd3",
    "--wp-accent-300": "#fda4af",
    "--wp-accent-400": "#fb7185",
    "--wp-accent-500": "#f43f5e",
    "--wp-accent-600": "#e11d48",
    "--wp-accent-700": "#be123c",
    "--wp-accent-800": "#9f1239",
    "--wp-accent-900": "#881337",
  },
  amber: {
    "--wp-accent-50":  "#fffbeb",
    "--wp-accent-100": "#fef3c7",
    "--wp-accent-200": "#fde68a",
    "--wp-accent-300": "#fcd34d",
    "--wp-accent-400": "#fbbf24",
    "--wp-accent-500": "#f59e0b",
    "--wp-accent-600": "#d97706",
    "--wp-accent-700": "#b45309",
    "--wp-accent-800": "#92400e",
    "--wp-accent-900": "#78350f",
  },
};

/** 500-stop hex used as the visible swatch color on the accent picker buttons. */
export const SWATCH_PREVIEW: Record<PresetAccent, string> = {
  violet: ACCENT_PALETTES.violet["--wp-accent-500"],
  indigo: ACCENT_PALETTES.indigo["--wp-accent-500"],
  teal:   ACCENT_PALETTES.teal["--wp-accent-500"],
  rose:   ACCENT_PALETTES.rose["--wp-accent-500"],
  amber:  ACCENT_PALETTES.amber["--wp-accent-500"],
};

/** The colour theme's own accent (Orbit's is the logo indigo). */
export const DEFAULT_ACCENT: AccentName = "theme";
export const DEFAULT_CUSTOM_HEX = ACCENT_PALETTES.indigo["--wp-accent-500"];

export const ACCENT_OPTIONS: PresetAccent[] = ["indigo", "violet", "teal", "rose", "amber"];

/** The name shown under each accent swatch (Tweaks + Settings › Appearance). */
export const ACCENT_LABELS: Record<AccentName, string> = {
  theme: "Theme's own",
  indigo: "Indigo",
  violet: "Violet",
  teal: "Teal",
  rose: "Rose",
  amber: "Amber",
  custom: "Custom",
};

export interface PaletteOption {
  id: PaletteName;
  label: string;
  hint: string;
  /** [page, card, accent] per mode, for the picker's swatch. */
  swatch: { dark: [string, string, string]; light: [string, string, string] };
  /** Keeps its own accent; the accent picker is off. */
  locksAccent?: boolean;
}

/** Values mirror styles/themes.css. */
export const PALETTE_OPTIONS: PaletteOption[] = [
  { id: "orbit",    label: "Orbit",         hint: "Logo indigo on cool ink. The default.",
    swatch: { dark: ["#0b0b12", "#1c1c28", "#4f46e5"], light: ["#f7f7fb", "#e6e6ee", "#4f46e5"] } },
  { id: "native",   label: "Native",        hint: "ComfyUI's own greys.",
    swatch: { dark: ["#18181a", "#313235", "#4f46e5"], light: ["#f3f3f3", "#d9d9d9", "#4f46e5"] } },
  { id: "nebula",   label: "Nebula",        hint: "Violet-tinted night with a violet accent.",
    swatch: { dark: ["#0d0a16", "#211a33", "#7c3aed"], light: ["#f8f6fd", "#e6e0f4", "#7c3aed"] } },
  { id: "tide",     label: "Tide",          hint: "Deep slate blue with a sky accent.",
    swatch: { dark: ["#0a1018", "#1a2534", "#0369a1"], light: ["#f4f7fa", "#dde5ee", "#0369a1"] } },
  { id: "ember",    label: "Ember",         hint: "Warm charcoal and paper with a copper accent.",
    swatch: { dark: ["#110d0b", "#251d19", "#c2410c"], light: ["#faf7f4", "#e9e0d7", "#c2410c"] } },
  { id: "contrast", label: "High contrast", hint: "Black and white, solid borders, a yellow focus ring.",
    swatch: { dark: ["#000000", "#262626", "#3730a3"], light: ["#ffffff", "#dedede", "#3730a3"] }, locksAccent: true },
];

export interface LookOption { id: LookName; label: string; hint: string }

export const LOOK_OPTIONS: LookOption[] = [
  { id: "orbit",     label: "Orbit",     hint: "Soft corners, hairline borders. The default." },
  { id: "crisp",     label: "Crisp",     hint: "Square corners, firm outlines, ruled lists." },
  { id: "soft",      label: "Soft",      hint: "Round pills, no outlines, cards lifted by shadow." },
  { id: "terminal",  label: "Terminal",  hint: "Mono everywhere, sharp corners, dashed rules." },
  { id: "editorial", label: "Editorial", hint: "Serif headings, open layout, underlined tabs." },
  { id: "compact",   label: "Compact",   hint: "Icon sidebar, tight rows, the most on screen." },
  { id: "tui",       label: "TUI",       hint: "Boxed panels, inverse selection and [x] checks." },
];

const PALETTE_IDS = new Set<string>(PALETTE_OPTIONS.map((p) => p.id));
const LOOK_IDS = new Set<string>(LOOK_OPTIONS.map((l) => l.id));
export const DENSITY_OPTIONS: Density[]   = ["compact", "comfortable", "cozy"];

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      case b: h = ((r - g) / d) + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mb = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)        { r = c; g = x; b = 0; }
  else if (h < 120)  { r = x; g = c; b = 0; }
  else if (h < 180)  { r = 0; g = c; b = x; }
  else if (h < 240)  { r = 0; g = x; b = c; }
  else if (h < 300)  { r = x; g = 0; b = c; }
  else               { r = c; g = 0; b = x; }
  const to = (n: number) => Math.round((n + mb) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Derive a 50→900 palette from a single "500" hex via HSL lightness
 *  walks. Saturation stays anchored so the ramp reads as one family
 *  rather than five unrelated colors. Falls back to the indigo default
 *  if the hex doesn't parse. */
export function paletteFromHex(hex: string): Record<string, string> {
  const hsl = hexToHsl(hex) ?? hexToHsl(DEFAULT_CUSTOM_HEX);
  if (!hsl) return {};
  const stops: Array<[string, number]> = [
    ["--wp-accent-50",  95],
    ["--wp-accent-100", 90],
    ["--wp-accent-200", 80],
    ["--wp-accent-300", 70],
    ["--wp-accent-400", 62],
    ["--wp-accent-500", hsl.l],
    ["--wp-accent-600", Math.max(8, hsl.l - 8)],
    ["--wp-accent-700", Math.max(6, hsl.l - 16)],
    ["--wp-accent-800", Math.max(4, hsl.l - 24)],
    ["--wp-accent-900", Math.max(3, hsl.l - 32)],
  ];
  const out: Record<string, string> = {};
  for (const [key, l] of stops) {
    out[key] = hslToHex(hsl.h, hsl.s, l);
  }
  return out;
}

interface PersistedShape {
  accent?: AccentName;
  palette?: PaletteName;
  look?: LookName;
  customHex?: string;
  /** Legacy — density now lives in the ui store, which reads this once. */
  density?: Density;
  sidebarMode?: SidebarMode;
  /** True once the user picked an accent. Before Orbit, "violet" was the
   *  default and got saved with any other tweak, and before colour themes
   *  "indigo" was, so an unpicked violet or indigo reads as the theme's own. */
  accentPicked?: boolean;
}

function readStored(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(value: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* localStorage unavailable */
  }
}

function hasDocument(): boolean {
  return typeof document !== "undefined" && !!document.documentElement;
}

export const useTweaksStore = defineStore("tweaks", () => {
  const stored = readStored();

  const accentPicked = ref<boolean>(stored.accentPicked === true);
  const accent      = ref<AccentName>(
    stored.accent && (accentPicked.value || (stored.accent !== "violet" && stored.accent !== "indigo"))
      ? stored.accent
      : DEFAULT_ACCENT,
  );
  const palette     = ref<PaletteName>(stored.palette && PALETTE_IDS.has(stored.palette) ? stored.palette : "orbit");
  const look        = ref<LookName>(stored.look && LOOK_IDS.has(stored.look) ? stored.look : "orbit");
  /** High contrast keeps its own accent. */
  const accentLocked = computed<boolean>(() => PALETTE_OPTIONS.some((p) => p.id === palette.value && p.locksAccent));
  const customHex   = ref<string>(stored.customHex ?? DEFAULT_CUSTOM_HEX);
  // Density moved to the ui store (one setting, shown on the Settings page
  // and here). This panel still offers it as a quick control.
  const ui = useUiStore();
  const density     = computed<Density>(() => ui.density);
  const sidebarMode = ref<SidebarMode>(stored.sidebarMode ?? "expanded");
  const panelOpen   = ref<boolean>(false);

  function applyAccent(name: AccentName) {
    if (!hasDocument()) return;
    // The theme's own ramp comes from styles/themes.css, so drop the inline one.
    if (name === "theme" || accentLocked.value) {
      clearAccent();
      return;
    }
    const ramp = name === "custom" ? paletteFromHex(customHex.value) : ACCENT_PALETTES[name];
    const root = document.documentElement;
    for (const [key, value] of Object.entries(ramp)) {
      root.style.setProperty(key, value);
    }
    // Mirror the prototype's `data-accent="<name>"` attribute so any rules in
    // tokens.css that key off it still resolve. Inline overrides win regardless.
    root.setAttribute("data-accent", name);
  }

  function clearAccent() {
    if (!hasDocument()) return;
    const root = document.documentElement;
    for (const key of Object.keys(ACCENT_PALETTES.violet)) {
      root.style.removeProperty(key);
    }
    root.removeAttribute("data-accent");
  }

  function setAccent(name: AccentName) {
    accentPicked.value = true;
    accent.value = name;
    applyAccent(name);
  }

  function applyThemeAttrs() {
    if (!hasDocument()) return;
    const root = document.documentElement;
    if (palette.value === "orbit") root.removeAttribute("data-wp-palette");
    else root.setAttribute("data-wp-palette", palette.value);
    if (look.value === "orbit") root.removeAttribute("data-wp-look");
    else root.setAttribute("data-wp-look", look.value);
  }

  function setPalette(name: PaletteName) {
    palette.value = name;
    applyThemeAttrs();
    applyAccent(accent.value);
  }

  function setLook(name: LookName) {
    const changed = look.value !== name;
    look.value = name;
    applyThemeAttrs();
    // Compact is drawn around the icon sidebar; picking it switches the
    // sidebar once (the Sidebar setting switches it back).
    if (changed && name === "compact" && !ui.sidebarCollapsed) {
      ui.setSidebarCollapsed(true);
      sidebarMode.value = "collapsed";
    }
  }

  function setCustomHex(hex: string) {
    customHex.value = hex;
    if (accent.value === "custom") applyAccent("custom");
  }

  function setDensity(d: Density) {
    ui.setDensity(d);
  }

  function setSidebarMode(mode: SidebarMode) {
    sidebarMode.value = mode;
  }

  function togglePanel() {
    panelOpen.value = !panelOpen.value;
  }

  function closePanel() {
    panelOpen.value = false;
  }

  function reset() {
    palette.value = "orbit";
    look.value = "orbit";
    applyThemeAttrs();
    accent.value = DEFAULT_ACCENT;
    accentPicked.value = false;
    customHex.value = DEFAULT_CUSTOM_HEX;
    ui.setDensity("comfortable");
    sidebarMode.value = "expanded";
    clearAccent();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Apply persisted overrides on app boot. Idempotent. */
  function initialize() {
    applyThemeAttrs();
    applyAccent(accent.value);
    // Re-applies (and, for a value still only in the legacy tweaks blob,
    // persists under the ui store's own key).
    ui.setDensity(ui.density);
  }

  // Persist on every change to a tracked field.
  watch(
    [accent, customHex, sidebarMode, accentPicked, palette, look],
    ([a, c, s, p, pal, lk]) => {
      writeStored({
        accent: a, customHex: c, sidebarMode: s, accentPicked: p || undefined,
        palette: pal === "orbit" ? undefined : pal, look: lk === "orbit" ? undefined : lk,
      });
    },
  );

  return {
    accent,
    palette,
    look,
    accentLocked,
    setPalette,
    setLook,
    customHex,
    setCustomHex,
    density,
    sidebarMode,
    panelOpen,
    setAccent,
    setDensity,
    setSidebarMode,
    togglePanel,
    closePanel,
    reset,
    initialize,
  };
});
