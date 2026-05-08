// Settings registered into ComfyUI's settings panel via
// app.registerExtension({ settings: [...] }) — see
// https://docs.comfy.org/custom-nodes/js/javascript_settings
//
// Two accessibility toggles, both defaulting to "auto" so they respect
// OS-level prefers-reduced-motion / prefers-contrast media queries until
// the user overrides them. Each setting writes a class onto <body>; CSS
// targets `.wp-*` descendants of that class to apply or strip the
// matching style.

// Side-effect import — owns the a11y CSS chunk so cssInjectedByJsPlugin
// can attach the runtime injection to a JS module. A bare CSS import
// from main.ts emits a chunk with no JS owner and the plugin warns.
import "../components/shared/a11y.css";

export type A11yMode = "auto" | "on" | "off";

export interface ComfySetting {
  id: string;
  name: string;
  type: "boolean" | "text" | "number" | "slider" | "combo" | "color" | "image" | "hidden";
  defaultValue: unknown;
  tooltip?: string;
  options?: Array<{ text: string; value: string }>;
  category?: string[];
  onChange?: (newVal: unknown, oldVal: unknown) => void;
}

const SETTING_ID_REDUCE_MOTION = "wildcardPipeline.a11y.reduceMotion";
const SETTING_ID_HIGH_CONTRAST = "wildcardPipeline.a11y.contrast";

const MOTION_OPTIONS = [
  { text: "Match system (prefers-reduced-motion)", value: "auto" },
  { text: "Always reduce", value: "on" },
  { text: "Always allow", value: "off" },
];

const CONTRAST_OPTIONS = [
  { text: "Match system (prefers-contrast)", value: "auto" },
  { text: "High contrast", value: "on" },
  { text: "Standard", value: "off" },
];

interface ExtensionManager {
  setting?: { get(id: string): unknown };
}
interface AppLike {
  extensionManager?: ExtensionManager;
}

// Module-state holds the current values directly. Updated synchronously
// by onChange callbacks so the marker classes flip without waiting for
// extensionManager.setting.get() to reflect the new value (it can lag
// the onChange fire by a tick, which made settings only "stick" after a
// hard refresh in the live UI).
const state: { reduceMotion: A11yMode; contrast: A11yMode } = {
  reduceMotion: "auto",
  contrast: "auto",
};

function asMode(v: unknown, fallback: A11yMode): A11yMode {
  return v === "on" || v === "off" || v === "auto" ? v : fallback;
}

/**
 * Apply current state + matchMedia to the body marker classes. Pure read
 * of the in-memory `state` map — no async layer. CSS keys off the markers:
 *   .wp-a11y-no-motion .wp-* { transition-duration: 0 !important; }
 *   .wp-a11y-high-contrast { --wp-border: ...; }
 */
function syncMarkers(): void {
  // Double `?.` is intentional: `matchMedia?.(...)` short-circuits the call,
  // but the subsequent `.matches` access still throws on undefined. Some
  // embedded shells expose a partial DOM where `matchMedia` returns
  // undefined or an object missing `.matches`; null-safe both hops.
  const reduceMotion = state.reduceMotion === "on"
    || (state.reduceMotion === "auto"
      && (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false));
  const highContrast = state.contrast === "on"
    || (state.contrast === "auto"
      && (window.matchMedia?.("(prefers-contrast: more)")?.matches ?? false));

  document.body.classList.toggle("wp-a11y-no-motion", !!reduceMotion);
  document.body.classList.toggle("wp-a11y-high-contrast", !!highContrast);
}

/**
 * Read both settings from extensionManager (used for initial sync at boot)
 * and re-apply markers. After this, `onChange` callbacks own state updates
 * directly via their newVal arg.
 */
export function applyA11yClasses(app: AppLike): void {
  state.reduceMotion = asMode(app.extensionManager?.setting?.get(SETTING_ID_REDUCE_MOTION), "auto");
  state.contrast = asMode(app.extensionManager?.setting?.get(SETTING_ID_HIGH_CONTRAST), "auto");
  syncMarkers();
}

/**
 * Wire matchMedia listeners so "auto" mode reflects OS-level changes
 * without requiring a page reload (e.g. user toggles "Reduce motion" in
 * macOS System Settings while ComfyUI is open).
 */
export function watchA11ySystemPrefs(): () => void {
  const motionMQ = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const contrastMQ = window.matchMedia?.("(prefers-contrast: more)");
  const handler = () => syncMarkers();
  motionMQ?.addEventListener?.("change", handler);
  contrastMQ?.addEventListener?.("change", handler);
  return () => {
    motionMQ?.removeEventListener?.("change", handler);
    contrastMQ?.removeEventListener?.("change", handler);
  };
}

/**
 * Dev-only console helpers for verifying the a11y CSS layer without
 * having to toggle OS-level preferences. Exposes:
 *
 *   wpDebugA11y.motion("on" | "off" | "auto")     // force a mode
 *   wpDebugA11y.contrast("on" | "off" | "auto")
 *   wpDebugA11y.refresh()                          // re-derive markers
 *   wpDebugA11y.state()                            // snapshot current state
 *
 * Gated on `import.meta.env.DEV` so the helpers don't ship to a packaged
 * extension. Workflow:
 *
 *   wpDebugA11y.state()        // { reduceMotion: "auto", contrast: "auto" }
 *   wpDebugA11y.contrast("on") // body class flips, CSS rules apply instantly
 *   wpDebugA11y.refresh()      // recompute (e.g. after manually toggling OS pref)
 */
export function installDebugHelpers(): void {
  if (!import.meta.env.DEV) return;
  const target = window as unknown as {
    wpDebugA11y?: {
      motion: (mode: A11yMode) => void;
      contrast: (mode: A11yMode) => void;
      refresh: () => void;
      state: () => { reduceMotion: A11yMode; contrast: A11yMode };
    };
  };
  target.wpDebugA11y = {
    motion: (mode: A11yMode) => {
      state.reduceMotion = mode;
      syncMarkers();
    },
    contrast: (mode: A11yMode) => {
      state.contrast = mode;
      syncMarkers();
    },
    refresh: () => syncMarkers(),
    state: () => ({ ...state }),
  };
}

export function buildSettings(_app: AppLike): ComfySetting[] {
  return [
    {
      id: SETTING_ID_REDUCE_MOTION,
      name: "Reduce motion",
      type: "combo",
      options: MOTION_OPTIONS,
      defaultValue: "auto",
      tooltip:
        "Disables Wildcard Pipeline animations and transitions. " +
        "Match system honors the OS prefers-reduced-motion setting.",
      category: ["Wildcard Pipeline", "Accessibility", "Reduce motion"],
      // Use newVal directly — extensionManager.setting.get() can lag the
      // onChange fire by a tick, which delayed the marker swap until a
      // page reload in the live UI.
      onChange: (newVal) => {
        state.reduceMotion = asMode(newVal, "auto");
        syncMarkers();
      },
    },
    {
      id: SETTING_ID_HIGH_CONTRAST,
      name: "Contrast",
      type: "combo",
      options: CONTRAST_OPTIONS,
      defaultValue: "auto",
      tooltip:
        "Bumps border + text contrast on Wildcard Pipeline widgets. " +
        "Match system honors the OS prefers-contrast setting.",
      category: ["Wildcard Pipeline", "Accessibility", "Contrast"],
      onChange: (newVal) => {
        state.contrast = asMode(newVal, "auto");
        syncMarkers();
      },
    },
  ];
}
