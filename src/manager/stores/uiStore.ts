import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** User-selected theme mode. `"auto"` follows the OS `prefers-color-scheme`. */
export type ThemeMode = "dark" | "light" | "auto";

/** Spacing/height density mode. `"comfortable"` is the default (multiplier 1). */
export type DensityMode = "comfortable" | "compact";

const STORAGE_KEY = "wp-theme-mode";
const STORAGE_KEY_DENSITY = "wp-density-mode";
const STORAGE_KEY_MAX_REF_DEPTH = "wp-wildcard-max-ref-depth";
const STORAGE_KEY_CHECK_ON_LAUNCH = "wp-update-check-on-launch";
const STORAGE_KEY_KEEP_EMPTY_GROUPS = "wp-keep-empty-tag-groups";
const FLASH_SUPPRESS_MS = 120;
const DEFAULT_MAX_REF_DEPTH = 8;
const MIN_MAX_REF_DEPTH = 1;
const MAX_MAX_REF_DEPTH = 32;

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

function readStoredDensity(): DensityMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_DENSITY);
    if (v === "comfortable" || v === "compact") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "comfortable";
}

/**
 * Whether an axis with no tags in it survives a save.
 *
 * A "+ Group" box the user created and had not filled yet was dropped on
 * save, which reads as the editor deleting their work — they had made the
 * group deliberately and intended to fill it later. Dropping is still the
 * default, because it is also what clears up boxes made by accident, but the
 * choice is now theirs.
 *
 * A preference rather than payload state: an empty axis is already
 * representable as `{axis: []}`, which the engine's validator accepts, so
 * keeping one needs no new field and no schema bump. The DECISION is what
 * varies per user; the RESULT is recorded in the payload like any other edit.
 */
function readStoredKeepEmptyGroups(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_KEEP_EMPTY_GROUPS) === "1";
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

function readStoredMaxRefDepth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY_MAX_REF_DEPTH);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= MIN_MAX_REF_DEPTH && n <= MAX_MAX_REF_DEPTH) {
        return n;
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_MAX_REF_DEPTH;
}

function readStoredCheckOnLaunch(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CHECK_ON_LAUNCH);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* localStorage unavailable */
  }
  return true; // default: check on launch
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useUiStore = defineStore("ui", () => {
  const themeMode = ref<ThemeMode>(readStoredTheme());
  const density = ref<DensityMode>(readStoredDensity());
  const sidebarCollapsed = ref(false);
  const maxRefDepth = ref<number>(readStoredMaxRefDepth());
  const checkOnLaunch = ref<boolean>(readStoredCheckOnLaunch());
  const keepEmptyTagGroups = ref<boolean>(readStoredKeepEmptyGroups());

  function setKeepEmptyTagGroups(v: boolean): void {
    keepEmptyTagGroups.value = v;
    try {
      localStorage.setItem(STORAGE_KEY_KEEP_EMPTY_GROUPS, v ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
  }

  /** Resolved theme — `"auto"` collapsed to dark/light via OS preference. */
  const resolvedTheme = computed<"dark" | "light">(() =>
    themeMode.value === "auto"
      ? (systemPrefersDark() ? "dark" : "light")
      : themeMode.value,
  );

  function applyThemeToDocument(mode: "dark" | "light") {
    const html = document.documentElement;
    // Briefly suppress transitions so the swap paints in one frame.
    html.classList.add("wp-theme-switching");
    html.classList.toggle("wp-dark", mode === "dark");
    html.classList.toggle("wp-theme-light", mode === "light");
    window.setTimeout(() => html.classList.remove("wp-theme-switching"), FLASH_SUPPRESS_MS);
  }

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }

  function applyDensityToDocument(mode: DensityMode): void {
    const html = document.documentElement;
    html.classList.toggle("wp-density-compact", mode === "compact");
  }

  function setDensity(mode: DensityMode): void {
    density.value = mode;
    try { localStorage.setItem(STORAGE_KEY_DENSITY, mode); } catch { /* ignore */ }
    applyDensityToDocument(mode);
  }

  function toggleDensity(): void {
    setDensity(density.value === "comfortable" ? "compact" : "comfortable");
  }

  function setMaxRefDepth(depth: number) {
    const clamped = Math.max(MIN_MAX_REF_DEPTH, Math.min(MAX_MAX_REF_DEPTH, Math.floor(depth)));
    maxRefDepth.value = clamped;
    try { localStorage.setItem(STORAGE_KEY_MAX_REF_DEPTH, String(clamped)); } catch { /* ignore */ }
  }

  /** Cycle dark → light → auto → dark. */
  function cycleTheme() {
    const next: ThemeMode =
      themeMode.value === "dark" ? "light"
      : themeMode.value === "light" ? "auto"
      : "dark";
    setThemeMode(next);
  }

  function initializeTheme() {
    applyThemeToDocument(resolvedTheme.value);
    applyDensityToDocument(density.value);
    // React to OS theme changes when in auto mode.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (themeMode.value === "auto") applyThemeToDocument(resolvedTheme.value);
      };
      mq.addEventListener("change", onChange);
    }
    watch(resolvedTheme, (m) => applyThemeToDocument(m));
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setCheckOnLaunch(v: boolean): void {
    checkOnLaunch.value = v;
    try { localStorage.setItem(STORAGE_KEY_CHECK_ON_LAUNCH, String(v)); } catch { /* ignore */ }
  }

  return {
    themeMode,
    resolvedTheme,
    density,
    sidebarCollapsed,
    maxRefDepth,
    checkOnLaunch,
    keepEmptyTagGroups,
    setKeepEmptyTagGroups,
    cycleTheme,
    setThemeMode,
    setDensity,
    toggleDensity,
    setMaxRefDepth,
    setCheckOnLaunch,
    initializeTheme,
    toggleSidebar,
  };
});
