import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** User-selected theme mode. `"auto"` follows the OS `prefers-color-scheme`. */
export type ThemeMode = "dark" | "light" | "auto";

const STORAGE_KEY = "wp-theme-mode";
const FLASH_SUPPRESS_MS = 120;

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useUiStore = defineStore("ui", () => {
  const themeMode = ref<ThemeMode>(readStoredTheme());
  const sidebarCollapsed = ref(false);

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

  return {
    themeMode,
    resolvedTheme,
    sidebarCollapsed,
    cycleTheme,
    setThemeMode,
    initializeTheme,
    toggleSidebar,
  };
});
