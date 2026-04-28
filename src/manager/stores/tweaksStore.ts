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

export type AccentName  = "violet" | "indigo" | "teal" | "rose" | "amber";
export type Density     = "compact" | "comfortable";
export type SidebarMode = "expanded" | "collapsed";

const STORAGE_KEY = "wp-tweaks-v1";

/** Accent palette presets — full 50→900 scale from prototype `tweaks-panel.jsx`.
 *  The prototype only persists the 300–700 stops (since the mid-range is what
 *  surfaces in tinted backgrounds, gradients, and focus rings) but we override
 *  the whole scale so cross-theme consistency holds. */
export const ACCENT_PALETTES: Record<AccentName, Record<string, string>> = {
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
export const SWATCH_PREVIEW: Record<AccentName, string> = {
  violet: ACCENT_PALETTES.violet["--wp-accent-500"],
  indigo: ACCENT_PALETTES.indigo["--wp-accent-500"],
  teal:   ACCENT_PALETTES.teal["--wp-accent-500"],
  rose:   ACCENT_PALETTES.rose["--wp-accent-500"],
  amber:  ACCENT_PALETTES.amber["--wp-accent-500"],
};

export const ACCENT_OPTIONS: AccentName[] = ["violet", "indigo", "teal", "rose", "amber"];
export const DENSITY_OPTIONS: Density[]   = ["compact", "comfortable"];

const DENSITY_HEIGHT: Record<Density, string> = {
  compact:     "34px",
  comfortable: "38px",
};

interface PersistedShape {
  accent?: AccentName;
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
  const density     = ref<Density>(stored.density ?? "comfortable");
  const sidebarMode = ref<SidebarMode>(stored.sidebarMode ?? "expanded");
  const panelOpen   = ref<boolean>(false);

  function applyAccent(name: AccentName) {
    if (!hasDocument()) return;
    const palette = ACCENT_PALETTES[name];
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
    [accent, density, sidebarMode],
    ([a, d, s]) => {
      writeStored({ accent: a, density: d, sidebarMode: s });
    },
  );

  return {
    accent,
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
