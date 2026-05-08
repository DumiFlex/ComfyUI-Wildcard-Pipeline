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
import "../components/shared/display-prefs.css";
import { pushToast } from "../components/shared/toast-store";

export type A11yMode = "auto" | "on" | "off";
export type Density = "comfortable" | "compact" | "minimal";
export type Decoration = "full" | "minimal" | "off";
export type IndicatorStyle = "both" | "badge" | "dot";
export type KindStyle = "both" | "icon" | "chip";

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
const SETTING_ID_DENSITY = "wildcardPipeline.display.density";
const SETTING_ID_DECORATION = "wildcardPipeline.display.decoration";
const SETTING_ID_INDICATOR = "wildcardPipeline.display.indicatorStyle";
const SETTING_ID_BORDER = "wildcardPipeline.display.borderHighlight";
const SETTING_ID_COLLAPSED = "wildcardPipeline.display.collapsedByDefault";
const SETTING_ID_FOCUS = "wildcardPipeline.display.focusMode";
const SETTING_ID_KIND_STYLE = "wildcardPipeline.display.kindStyle";

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

const DENSITY_OPTIONS = [
  { text: "Comfortable (default)", value: "comfortable" },
  { text: "Compact", value: "compact" },
  { text: "Minimal", value: "minimal" },
];

const DECORATION_OPTIONS = [
  { text: "Full (default)", value: "full" },
  { text: "Minimal", value: "minimal" },
  { text: "Off (flat)", value: "off" },
];

const INDICATOR_OPTIONS = [
  { text: "Badge (default)", value: "badge" },
  { text: "Dot (compact)", value: "dot" },
  { text: "Both (verbose)", value: "both" },
];

const KIND_STYLE_OPTIONS = [
  { text: "Chip (default)", value: "chip" },
  { text: "Icon (compact)", value: "icon" },
  { text: "Both (verbose)", value: "both" },
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
const state: {
  reduceMotion: A11yMode;
  contrast: A11yMode;
  density: Density;
  decoration: Decoration;
  indicatorStyle: IndicatorStyle;
  borderHighlight: boolean;
  collapsedByDefault: boolean;
  focusMode: boolean;
  kindStyle: KindStyle;
} = {
  reduceMotion: "auto",
  contrast: "auto",
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  borderHighlight: true,
  collapsedByDefault: false,
  focusMode: false,
  kindStyle: "chip",
};

function asMode(v: unknown, fallback: A11yMode): A11yMode {
  return v === "on" || v === "off" || v === "auto" ? v : fallback;
}

function asDensity(v: unknown, fallback: Density): Density {
  return v === "comfortable" || v === "compact" || v === "minimal" ? v : fallback;
}

function asDecoration(v: unknown, fallback: Decoration): Decoration {
  return v === "full" || v === "minimal" || v === "off" ? v : fallback;
}

function asIndicator(v: unknown, fallback: IndicatorStyle): IndicatorStyle {
  return v === "both" || v === "badge" || v === "dot" ? v : fallback;
}

function asKindStyle(v: unknown, fallback: KindStyle): KindStyle {
  return v === "both" || v === "icon" || v === "chip" ? v : fallback;
}

/** Test-only: reset display preferences state to defaults. */
export function _resetDisplayStateForTesting(): void {
  state.density = "comfortable";
  state.decoration = "full";
  state.indicatorStyle = "badge";
  state.borderHighlight = true;
  state.collapsedByDefault = false;
  state.focusMode = false;
  state.kindStyle = "chip";
}

/**
 * Read accessor for the collapsedByDefault setting. ContextWidget calls
 * this when adding a new module to decide whether to push it into the
 * collapsed set. Module-level state keeps onChange in sync without
 * needing a Vue store.
 */
export function getCollapsedByDefault(): boolean {
  return state.collapsedByDefault;
}

// Toast feedback gate. ComfyUI fires onChange for stored values during
// page-load registration; we don't want a toast every refresh. Boot
// callers flip this true once the load-fire window has settled.
let bootCompleted = false;

export function markBootCompleted(): void {
  bootCompleted = true;
}

/** Test-only: reset the boot gate so tests can isolate boot vs post-boot. */
export function _resetBootForTesting(): void {
  bootCompleted = false;
}

function systemMotionMatches(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function systemContrastMatches(): boolean {
  return window.matchMedia?.("(prefers-contrast: more)")?.matches ?? false;
}

function describeMotion(mode: A11yMode): string {
  if (mode === "on") return "Reduce motion: ON";
  if (mode === "off") return "Reduce motion: OFF";
  return `Reduce motion: AUTO (system: ${systemMotionMatches() ? "reduce" : "allow"})`;
}

function describeContrast(mode: A11yMode): string {
  if (mode === "on") return "Contrast: HIGH";
  if (mode === "off") return "Contrast: STANDARD";
  return `Contrast: AUTO (system: ${systemContrastMatches() ? "high" : "standard"})`;
}

function describeDensity(mode: Density): string {
  return `Density: ${mode.toUpperCase()}`;
}

function describeDecoration(mode: Decoration): string {
  return `Decoration: ${mode.toUpperCase()}`;
}

function describeIndicator(mode: IndicatorStyle): string {
  if (mode === "both") return "Indicators: dot + badge";
  if (mode === "badge") return "Indicators: badge only";
  return "Indicators: dot only";
}

function describeKindStyle(mode: KindStyle): string {
  if (mode === "both") return "Module type: chip + icon";
  if (mode === "icon") return "Module type: icon only";
  return "Module type: chip only";
}

function describeBorder(on: boolean): string {
  return `Border highlights: ${on ? "ON" : "OFF"}`;
}

function describeCollapsed(on: boolean): string {
  return on ? "New modules: collapsed by default" : "New modules: expanded by default";
}

function describeFocus(on: boolean): string {
  return `Focus mode: ${on ? "ON" : "OFF"}`;
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

  // Display — density (exactly one density class on body at a time)
  document.body.classList.toggle("wp-density-comfortable", state.density === "comfortable");
  document.body.classList.toggle("wp-density-compact", state.density === "compact");
  document.body.classList.toggle("wp-density-minimal", state.density === "minimal");

  // Display — decoration
  document.body.classList.toggle("wp-decor-full", state.decoration === "full");
  document.body.classList.toggle("wp-decor-minimal", state.decoration === "minimal");
  document.body.classList.toggle("wp-decor-off", state.decoration === "off");

  // Display — indicator style
  document.body.classList.toggle("wp-indicator-both", state.indicatorStyle === "both");
  document.body.classList.toggle("wp-indicator-badge", state.indicatorStyle === "badge");
  document.body.classList.toggle("wp-indicator-dot", state.indicatorStyle === "dot");

  // Display — border highlight (state-marker borders)
  document.body.classList.toggle("wp-border-highlight-on", state.borderHighlight === true);
  document.body.classList.toggle("wp-border-highlight-off", state.borderHighlight === false);

  // Display — focus mode (hovering one module dims siblings)
  document.body.classList.toggle("wp-focus-mode", state.focusMode === true);

  // Display — kind style (module type icon vs chip vs both)
  document.body.classList.toggle("wp-kind-style-icon", state.kindStyle === "icon");
  document.body.classList.toggle("wp-kind-style-chip", state.kindStyle === "chip");
  document.body.classList.toggle("wp-kind-style-both", state.kindStyle === "both");
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
 * Read display-preference settings from extensionManager (used for initial
 * sync at boot) and re-apply markers. After this, `onChange` callbacks own
 * state updates directly via their newVal arg.
 */
export function applyDisplayPrefs(app: AppLike): void {
  state.density = asDensity(app.extensionManager?.setting?.get(SETTING_ID_DENSITY), "comfortable");
  state.decoration = asDecoration(app.extensionManager?.setting?.get(SETTING_ID_DECORATION), "full");
  state.indicatorStyle = asIndicator(app.extensionManager?.setting?.get(SETTING_ID_INDICATOR), "badge");
  // Boolean default true — only an explicit `=== false` reading flips the
  // marker. `undefined` (settings panel never visited) falls through to true.
  state.borderHighlight = app.extensionManager?.setting?.get(SETTING_ID_BORDER) !== false;
  // Boolean default false — only an explicit `=== true` enables it.
  // No body class for this setting; ContextWidget reads via getCollapsedByDefault().
  state.collapsedByDefault = app.extensionManager?.setting?.get(SETTING_ID_COLLAPSED) === true;
  state.focusMode = app.extensionManager?.setting?.get(SETTING_ID_FOCUS) === true;
  state.kindStyle = asKindStyle(app.extensionManager?.setting?.get(SETTING_ID_KIND_STYLE), "chip");
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
 * Dev-only console helpers for verifying the a11y + display CSS layers
 * without touching OS-level preferences or the ComfyUI settings panel.
 * Gated on `import.meta.env.DEV` so they don't ship to a packaged extension.
 *
 *   wpDebug.a11y.motion("on" | "off" | "auto")
 *   wpDebug.a11y.contrast("on" | "off" | "auto")
 *   wpDebug.a11y.refresh()
 *   wpDebug.a11y.state()
 *
 *   wpDebug.display.density("comfortable" | "compact" | "minimal")
 *   wpDebug.display.decoration("full" | "minimal" | "off")
 *   wpDebug.display.indicatorStyle("both" | "badge" | "dot")
 *   wpDebug.display.borderHighlight(boolean)
 *   wpDebug.display.collapsedByDefault(boolean)
 *   wpDebug.display.focusMode(boolean)
 *   wpDebug.display.state()
 *
 *   wpDebug.refresh()  // re-derive every body marker
 *
 * Note: `window.wpDebugA11y` stays as a back-compat alias for one cycle
 * (then removed in Phase 2). New code should use `window.wpDebug.a11y`.
 */
export function installDebugHelpers(): void {
  if (!import.meta.env.DEV) return;
  const win = window as unknown as Record<string, unknown>;

  const a11y = {
    motion: (mode: A11yMode) => { state.reduceMotion = mode; syncMarkers(); },
    contrast: (mode: A11yMode) => { state.contrast = mode; syncMarkers(); },
    refresh: () => syncMarkers(),
    state: () => ({ reduceMotion: state.reduceMotion, contrast: state.contrast }),
  };

  const display = {
    density: (mode: Density) => { state.density = mode; syncMarkers(); },
    decoration: (mode: Decoration) => { state.decoration = mode; syncMarkers(); },
    indicatorStyle: (mode: IndicatorStyle) => { state.indicatorStyle = mode; syncMarkers(); },
    borderHighlight: (on: boolean) => { state.borderHighlight = on; syncMarkers(); },
    // collapsedByDefault is pure Vue state — no syncMarkers since it has
    // no body class. ContextWidget reads via getCollapsedByDefault().
    collapsedByDefault: (on: boolean) => { state.collapsedByDefault = on; },
    focusMode: (on: boolean) => { state.focusMode = on; syncMarkers(); },
    kindStyle: (mode: KindStyle) => { state.kindStyle = mode; syncMarkers(); },
    state: () => ({
      density: state.density,
      decoration: state.decoration,
      indicatorStyle: state.indicatorStyle,
      borderHighlight: state.borderHighlight,
      collapsedByDefault: state.collapsedByDefault,
      focusMode: state.focusMode,
      kindStyle: state.kindStyle,
    }),
  };

  win.wpDebug = { a11y, display, refresh: () => syncMarkers() };
  // Deprecation alias — kept for one cycle so existing console workflows
  // (and any external scripts) keep working. Remove on next display-prefs
  // cycle (Phase 2).
  win.wpDebugA11y = a11y;
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
      // page reload in the live UI. Toast feedback is gated on
      // `bootCompleted` so ComfyUI's load-fire (with the stored value)
      // doesn't pop a toast every refresh, and uses singletonKey so
      // rapid dropdown clicks replace the existing toast in place.
      onChange: (newVal) => {
        const next = asMode(newVal, "auto");
        const changed = next !== state.reduceMotion;
        state.reduceMotion = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeMotion(next), {
            severity: "info",
            singletonKey: "a11y-motion",
          });
        }
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
        const next = asMode(newVal, "auto");
        const changed = next !== state.contrast;
        state.contrast = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeContrast(next), {
            severity: "info",
            singletonKey: "a11y-contrast",
          });
        }
      },
    },
    // Display preferences — ordered by visual concern (sizing → look →
    // chrome → state markers → behavior). Tooltips kept short; the
    // dropdown options carry the detailed mode descriptions.
    {
      id: SETTING_ID_DENSITY,
      name: "Module density",
      type: "combo",
      options: DENSITY_OPTIONS,
      defaultValue: "comfortable",
      tooltip: "Module spacing and chip sizes.",
      category: ["Wildcard Pipeline", "Display", "Density"],
      onChange: (newVal) => {
        const next = asDensity(newVal, "comfortable");
        const changed = next !== state.density;
        state.density = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeDensity(next), {
            severity: "info",
            singletonKey: "wp-density",
          });
        }
      },
    },
    {
      id: SETTING_ID_DECORATION,
      name: "Decoration",
      type: "combo",
      options: DECORATION_OPTIONS,
      defaultValue: "full",
      tooltip: "Gradients & shadows. Off = flat (weak GPU / remote desktop).",
      category: ["Wildcard Pipeline", "Display", "Decoration"],
      onChange: (newVal) => {
        const next = asDecoration(newVal, "full");
        const changed = next !== state.decoration;
        state.decoration = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeDecoration(next), {
            severity: "info",
            singletonKey: "wp-decoration",
          });
        }
      },
    },
    {
      id: SETTING_ID_KIND_STYLE,
      name: "Module type style",
      type: "combo",
      options: KIND_STYLE_OPTIONS,
      defaultValue: "chip",
      tooltip: "How module type shows: chip text, icon glyph, or both.",
      category: ["Wildcard Pipeline", "Display", "Module type style"],
      onChange: (newVal) => {
        const next = asKindStyle(newVal, "chip");
        const changed = next !== state.kindStyle;
        state.kindStyle = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeKindStyle(next), {
            severity: "info",
            singletonKey: "wp-kind-style",
          });
        }
      },
    },
    {
      id: SETTING_ID_INDICATOR,
      name: "State indicator style",
      type: "combo",
      options: INDICATOR_OPTIONS,
      defaultValue: "badge",
      tooltip: "How mod / missing / drift / conflict markers appear.",
      category: ["Wildcard Pipeline", "Display", "State indicator style"],
      onChange: (newVal) => {
        const next = asIndicator(newVal, "badge");
        const changed = next !== state.indicatorStyle;
        state.indicatorStyle = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeIndicator(next), {
            severity: "info",
            singletonKey: "wp-indicator",
          });
        }
      },
    },
    {
      id: SETTING_ID_BORDER,
      name: "State border highlights",
      type: "boolean",
      defaultValue: true,
      tooltip: "Color the module border by its state.",
      category: ["Wildcard Pipeline", "Display", "State border highlights"],
      onChange: (newVal) => {
        const next = newVal !== false;
        const changed = next !== state.borderHighlight;
        state.borderHighlight = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeBorder(next), {
            severity: "info",
            singletonKey: "wp-border-highlight",
          });
        }
      },
    },
    {
      id: SETTING_ID_COLLAPSED,
      name: "Collapse new modules by default",
      type: "boolean",
      defaultValue: false,
      tooltip: "New modules render with body hidden (header only).",
      category: ["Wildcard Pipeline", "Display", "Collapse default"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.collapsedByDefault;
        state.collapsedByDefault = next;
        // No syncMarkers — pure Vue state read by ContextWidget on add.
        if (bootCompleted && changed) {
          pushToast(describeCollapsed(next), {
            severity: "info",
            singletonKey: "wp-collapsed-default",
          });
        }
      },
    },
    {
      id: SETTING_ID_FOCUS,
      name: "Focus mode",
      type: "boolean",
      defaultValue: false,
      tooltip: "Hover a module to dim the others.",
      category: ["Wildcard Pipeline", "Display", "Focus mode"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.focusMode;
        state.focusMode = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeFocus(next), {
            severity: "info",
            singletonKey: "wp-focus-mode",
          });
        }
      },
    },
  ];
}
