import { defineStore } from "pinia";
import { ref, watch } from "vue";

/**
 * Runtime tweaks store — accent palette, density, sidebar mode.
 *
 * Lets the user A/B different look-and-feel options without rebuilding.
 * Overrides apply via inline CSS variables on `<html>` and persist to
 * `localStorage` under `wp-tweaks-v1`.
 *
 * Mirror of the prototype's `tweaks-panel.jsx` host protocol — without the
 * postMessage iframe dance, since we own the document directly.
 */

export type AccentName  = "violet" | "indigo" | "teal" | "rose" | "amber" | "custom";
export type Density     = "compact" | "comfortable" | "cozy";
export type SidebarMode = "expanded" | "collapsed";

const STORAGE_KEY = "wp-tweaks-v1";

/** Accent palette presets — full 50→900 scale from prototype `tweaks-panel.jsx`.
 *  The prototype only persists the 300–700 stops (since the mid-range is what
 *  surfaces in tinted backgrounds, gradients, and focus rings) but we override
 *  the whole scale so cross-theme consistency holds.
 *
 *  The "custom" key intentionally points at a placeholder palette; the actual
 *  palette is generated from the user's hex via `paletteFromHex()` below. */
export const ACCENT_PALETTES: Record<Exclude<AccentName, "custom">, Record<string, string>> = {
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
export const SWATCH_PREVIEW: Record<Exclude<AccentName, "custom">, string> = {
  violet: ACCENT_PALETTES.violet["--wp-accent-500"],
  indigo: ACCENT_PALETTES.indigo["--wp-accent-500"],
  teal:   ACCENT_PALETTES.teal["--wp-accent-500"],
  rose:   ACCENT_PALETTES.rose["--wp-accent-500"],
  amber:  ACCENT_PALETTES.amber["--wp-accent-500"],
};

export const DEFAULT_CUSTOM_HEX = ACCENT_PALETTES.violet["--wp-accent-500"];

export const ACCENT_OPTIONS: Array<Exclude<AccentName, "custom">> = ["violet", "indigo", "teal", "rose", "amber"];
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
 *  rather than five unrelated colors. Falls back to the violet default
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

const DENSITY_HEIGHT: Record<Density, string> = {
  compact:     "32px",
  comfortable: "38px",
  cozy:        "44px",
};

interface PersistedShape {
  accent?: AccentName;
  customHex?: string;
  density?: Density;
  sidebarMode?: SidebarMode;
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

  const accent      = ref<AccentName>(stored.accent ?? "violet");
  const customHex   = ref<string>(stored.customHex ?? DEFAULT_CUSTOM_HEX);
  const density     = ref<Density>(stored.density ?? "comfortable");
  const sidebarMode = ref<SidebarMode>(stored.sidebarMode ?? "expanded");
  const panelOpen   = ref<boolean>(false);

  function applyAccent(name: AccentName) {
    if (!hasDocument()) return;
    let palette: Record<string, string>;
    if (name === "custom") {
      palette = paletteFromHex(customHex.value);
    } else {
      palette = ACCENT_PALETTES[name];
    }
    const root = document.documentElement;
    for (const [key, value] of Object.entries(palette)) {
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

  function applyDensity(d: Density) {
    if (!hasDocument()) return;
    const root = document.documentElement;
    const h = DENSITY_HEIGHT[d];
    root.style.setProperty("--wp-input-h", h);
    root.style.setProperty("--wp-btn-h", h);
  }

  function clearDensity() {
    if (!hasDocument()) return;
    const root = document.documentElement;
    root.style.removeProperty("--wp-input-h");
    root.style.removeProperty("--wp-btn-h");
  }

  function setAccent(name: AccentName) {
    accent.value = name;
    applyAccent(name);
  }

  function setCustomHex(hex: string) {
    customHex.value = hex;
    if (accent.value === "custom") applyAccent("custom");
  }

  function setDensity(d: Density) {
    density.value = d;
    applyDensity(d);
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
    accent.value = "violet";
    customHex.value = DEFAULT_CUSTOM_HEX;
    density.value = "comfortable";
    sidebarMode.value = "expanded";
    clearAccent();
    clearDensity();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Apply persisted overrides on app boot. Idempotent. */
  function initialize() {
    applyAccent(accent.value);
    applyDensity(density.value);
  }

  // Persist on every change to a tracked field.
  watch(
    [accent, customHex, density, sidebarMode],
    ([a, c, d, s]) => {
      writeStored({ accent: a, customHex: c, density: d, sidebarMode: s });
    },
  );

  return {
    accent,
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
