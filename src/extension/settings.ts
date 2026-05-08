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
import { reactive } from "vue";
import "../components/shared/a11y.css";
import "../components/shared/display-prefs.css";
import { pushToast } from "../components/shared/toast-store";
import { openPlayground } from "../components/settings/playground-store";

export type A11yMode = "auto" | "on" | "off";
export type Density = "comfortable" | "compact" | "minimal";
export type Decoration = "full" | "minimal" | "off";
export type IndicatorStyle = "both" | "badge" | "dot";
export type KindStyle = "both" | "icon" | "chip";
export type ValidationMode = "strict" | "relaxed" | "permissive";
export type ToastLifetime = "short" | "default" | "long" | "sticky";
export type CollapseMode = "independent" | "accordion";

/**
 * Setting widget types ComfyUI's settings panel can render natively.
 *
 * The CLI docs at docs.comfy.org/custom-nodes/js/javascript_settings list
 * 8 (`boolean | text | number | slider | combo | color | image | hidden`)
 * but the actual frontend type contract in
 * `Comfy-Org/ComfyUI_frontend/src/platform/settings/types.ts` exposes 12
 * string types plus a custom-renderer function. Documenting the full set
 * here so contributors don't fight TypeScript errors when reaching for
 * `radio` or the renderer escape hatch.
 */
export type ComfySettingInputType =
  | "boolean"
  | "text"
  | "number"
  | "slider"
  | "combo"
  | "color"
  | "image"
  | "hidden"
  | "knob"
  | "radio"
  | "url"
  | "backgroundImage";

/**
 * Function-typed setting renderer. ComfyUI calls it when the panel
 * mounts and uses the returned `HTMLElement` as the entire input cell
 * for that setting (replacing the native widget).
 *
 * Wire `setter(newValue)` from your widget's change handler — that's
 * how the value persists to `extensionManager.setting`. `value` is the
 * current stored value at render time. `attrs` is an optional bag of
 * extra props ComfyUI may pass (rarely used; the rgthree + KJNodes
 * extensions both ignore it).
 *
 * Must be synchronous — same constraint as `getCustomWidgets`. Don't
 * return a Promise; ComfyUI won't await it.
 *
 * Reference patterns (verified working in ComfyUI v1.33+):
 *   - rgthree-comfy: returns a `<tr>` containing a launcher button that
 *     opens its own custom dialog (clean panel, all UI in dialog)
 *   - ComfyUI-KJNodes: returns a raw `<button>` for one-shot actions
 *     (e.g. "Convert all SetGet nodes")
 */
export type ComfySettingCustomRenderer = (
  name: string,
  setter: (value: unknown) => void,
  value: unknown,
  attrs?: Record<string, unknown>,
) => HTMLElement;

export interface ComfySetting {
  id: string;
  name: string;
  type: ComfySettingInputType | ComfySettingCustomRenderer;
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
const SETTING_ID_COLLAPSE_MODE = "wildcardPipeline.display.collapseMode";

const SETTING_ID_VALIDATION = "wildcardPipeline.behavior.validation";
const SETTING_ID_TOAST_LIFETIME = "wildcardPipeline.behavior.toastLifetime";
const SETTING_ID_SUPPRESS_INFO = "wildcardPipeline.behavior.suppressInfoToasts";
const SETTING_ID_NEW_DISABLED = "wildcardPipeline.behavior.newModuleDisabled";

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

const VALIDATION_OPTIONS = [
  { text: "Strict (show all conflicts)", value: "strict" },
  { text: "Relaxed (hide info-level overrides)", value: "relaxed" },
  { text: "Permissive (scanner off — no warnings)", value: "permissive" },
];

const TOAST_LIFETIME_OPTIONS = [
  { text: "Short (3 s)", value: "short" },
  { text: "Default (5 s)", value: "default" },
  { text: "Long (10 s)", value: "long" },
  { text: "Sticky (no auto-dismiss)", value: "sticky" },
];

const COLLAPSE_MODE_OPTIONS = [
  { text: "Independent (default)", value: "independent" },
  { text: "Accordion (expanding one collapses siblings)", value: "accordion" },
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
// Wrap in `reactive()` so consumers reading via getValidationMode() /
// getCollapsedByDefault() / etc. get Vue dependency tracking — when a
// computed in ContextWidget reads getValidationMode(), Vue tracks the
// underlying `state.validation` access; flipping the mode via onChange
// then triggers the computed to recompute. Without `reactive`, the
// `conflicts` filter would stay stale until something else upstream
// (props, value) happened to invalidate the cache.
const state = reactive<{
  reduceMotion: A11yMode;
  contrast: A11yMode;
  density: Density;
  decoration: Decoration;
  indicatorStyle: IndicatorStyle;
  borderHighlight: boolean;
  collapsedByDefault: boolean;
  focusMode: boolean;
  kindStyle: KindStyle;
  validation: ValidationMode;
  toastLifetime: ToastLifetime;
  suppressInfoToasts: boolean;
  newModuleDisabled: boolean;
  collapseMode: CollapseMode;
}>({
  reduceMotion: "auto",
  contrast: "auto",
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  borderHighlight: true,
  collapsedByDefault: false,
  focusMode: false,
  kindStyle: "chip",
  validation: "strict",
  toastLifetime: "default",
  suppressInfoToasts: false,
  newModuleDisabled: false,
  collapseMode: "independent",
});

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

function asValidation(v: unknown, fallback: ValidationMode): ValidationMode {
  return v === "strict" || v === "relaxed" || v === "permissive" ? v : fallback;
}

function asToastLifetime(v: unknown, fallback: ToastLifetime): ToastLifetime {
  return v === "short" || v === "default" || v === "long" || v === "sticky" ? v : fallback;
}

function asCollapseMode(v: unknown, fallback: CollapseMode): CollapseMode {
  return v === "independent" || v === "accordion" ? v : fallback;
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
  state.validation = "strict";
  state.toastLifetime = "default";
  state.suppressInfoToasts = false;
  state.newModuleDisabled = false;
  state.collapseMode = "independent";
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

/**
 * Read accessor for the conflict-scanner mode. Conflict consumers
 * (ContextWidget, subgraph-badge) call this to decide which conflicts
 * to surface:
 *   - "strict"     → all conflicts visible (current default)
 *   - "relaxed"    → drop info-severity (shadows_upstream is hidden)
 *   - "permissive" → empty array (scanner-off)
 */
export function getValidationMode(): ValidationMode {
  return state.validation;
}

/**
 * Read accessor for the default toast lifetime in milliseconds.
 * `pushToast` reads this when no explicit `lifeMs` option is passed,
 * so user changes to the setting reach all callers without per-callsite
 * threading. Returns 0 for "sticky" — `pushToast` interprets 0 as
 * "no auto-dismiss". */
export function getToastLifetimeMs(): number {
  switch (state.toastLifetime) {
    case "short":   return 3000;
    case "long":    return 10000;
    case "sticky":  return 0;
    case "default": default: return 5000;
  }
}

/**
 * Read accessor for the suppress-info-toasts boolean. The toast store
 * checks this on each push — when true, info-severity toasts are
 * dropped silently. Used to filter out chatty status confirmations
 * (a11y mode toggles, density changes, etc.) without losing the
 * warning + error severities, which always render. */
export function shouldSuppressInfoToasts(): boolean {
  return state.suppressInfoToasts;
}

/**
 * Read accessor for the newModuleDisabled boolean. ContextWidget
 * checks this when embedding new modules from the picker — when true,
 * each new module starts with `enabled: false` so users can configure
 * it before letting it run. Existing modules are unaffected. */
export function getNewModuleDisabled(): boolean {
  return state.newModuleDisabled;
}

/**
 * Read accessor for the collapse-stack mode. ContextWidget reads this
 * inside `toggleCollapsed` to decide whether expanding one module
 * should collapse all siblings (accordion) or leave them alone
 * (independent — current default).
 *
 *   - "independent" → each module's collapse state is orthogonal (default)
 *   - "accordion"   → only one module can be expanded at a time;
 *                     expanding any module collapses every other one
 */
export function getCollapseMode(): CollapseMode {
  return state.collapseMode;
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

function describeValidation(mode: ValidationMode): string {
  if (mode === "permissive") return "Validation: PERMISSIVE (scanner off)";
  if (mode === "relaxed") return "Validation: RELAXED";
  return "Validation: STRICT";
}

function describeToastLifetime(mode: ToastLifetime): string {
  if (mode === "sticky") return "Toast lifetime: STICKY";
  if (mode === "short") return "Toast lifetime: 3 s";
  if (mode === "long") return "Toast lifetime: 10 s";
  return "Toast lifetime: 5 s";
}

function describeSuppressInfo(on: boolean): string {
  return `Info-severity toasts: ${on ? "SUPPRESSED" : "shown"}`;
}

function describeNewModuleDisabled(on: boolean): string {
  return on ? "New modules start disabled" : "New modules start enabled";
}

function describeCollapseMode(mode: CollapseMode): string {
  return mode === "accordion"
    ? "Collapse mode: ACCORDION"
    : "Collapse mode: INDEPENDENT";
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
  // Phase 2 — behavior axes. None of these flip body classes (they
  // gate consumer logic in conflicts.ts / toast-store / ContextWidget
  // add path), but they read from the same store at boot.
  state.validation = asValidation(app.extensionManager?.setting?.get(SETTING_ID_VALIDATION), "strict");
  state.toastLifetime = asToastLifetime(app.extensionManager?.setting?.get(SETTING_ID_TOAST_LIFETIME), "default");
  state.suppressInfoToasts = app.extensionManager?.setting?.get(SETTING_ID_SUPPRESS_INFO) === true;
  state.newModuleDisabled = app.extensionManager?.setting?.get(SETTING_ID_NEW_DISABLED) === true;
  // Phase 3b — collapse-stack mode. Pure Vue state (no body class) since
  // the behavior is JS-driven (toggleCollapsed reads via getCollapseMode).
  state.collapseMode = asCollapseMode(app.extensionManager?.setting?.get(SETTING_ID_COLLAPSE_MODE), "independent");
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
    // collapseMode is pure Vue state — no syncMarkers since it has
    // no body class. ContextWidget reads via getCollapseMode().
    collapseMode: (mode: CollapseMode) => { state.collapseMode = mode; },
    state: () => ({
      density: state.density,
      decoration: state.decoration,
      indicatorStyle: state.indicatorStyle,
      borderHighlight: state.borderHighlight,
      collapsedByDefault: state.collapsedByDefault,
      focusMode: state.focusMode,
      kindStyle: state.kindStyle,
      collapseMode: state.collapseMode,
    }),
  };

  win.wpDebug = { a11y, display, refresh: () => syncMarkers() };
  // Deprecation alias — kept for one cycle so existing console workflows
  // (and any external scripts) keep working. Remove on next display-prefs
  // cycle (Phase 2).
  win.wpDebugA11y = a11y;
}

export function buildSettings(_app: AppLike): ComfySetting[] {
  // ComfyUI groups settings by 2nd-level category (alphabetical) and
  // renders entries in array order within each section. To put the
  // playground first in the WP tab, all entries live under a single
  // "Display" section — accessibility (motion + contrast) used to
  // have its own section but it sorted alphabetically before Display
  // (A < D), pushing the playground launcher to second place. Keeping
  // them all in one section lets array order alone control layout.
  return [
    // Launcher row — uses the SettingCustomRenderer escape hatch
    // (`type: function`) to render a button styled like a PrimeVue
    // Select control so it visually fits the rest of the panel. Click
    // → opens the playground modal with live mockup + all controls.
    // Pattern adopted from rgthree-comfy + ComfyUI-KJNodes.
    {
      id: "wildcardPipeline.display._playground",
      name: "Display playground",
      type: (_name, _setter, _value, _attrs) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Open playground";
        btn.title = "Live preview of every display + a11y setting in one place.";
        btn.style.cssText = [
          "background: var(--wp-accent, #6366f1)",
          "border: 1px solid var(--wp-accent, #6366f1)",
          "border-radius: var(--wp-radius-sm, 4px)",
          "color: #fff",
          "font: 600 13px/1.2 var(--wp-font-sans, sans-serif)",
          // Match PrimeVue Select control height (~32-34px) so the
          // button doesn't sit shorter than its dropdown neighbours.
          "min-height: 32px",
          "padding: 6px 14px",
          "cursor: pointer",
          "transition: background-color 0.15s, border-color 0.15s",
        ].join("; ");
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "var(--wp-accent2, #a970ff)";
          btn.style.borderColor = "var(--wp-accent2, #a970ff)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "var(--wp-accent, #6366f1)";
          btn.style.borderColor = "var(--wp-accent, #6366f1)";
        });
        btn.addEventListener("click", () => openPlayground());
        return btn;
      },
      defaultValue: null,
      tooltip: "Live preview of every display + a11y setting in one place.",
      category: ["Wildcard Pipeline", "Display", "Playground"],
    },
    // Visual axes — sizing, embellishment, identity
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
      id: SETTING_ID_COLLAPSE_MODE,
      name: "Collapse stack mode",
      type: "combo",
      options: COLLAPSE_MODE_OPTIONS,
      defaultValue: "independent",
      tooltip:
        "Independent: each module collapses on its own. " +
        "Accordion: expanding a module collapses all others.",
      category: ["Wildcard Pipeline", "Display", "Collapse stack mode"],
      onChange: (newVal) => {
        const next = asCollapseMode(newVal, "independent");
        const changed = next !== state.collapseMode;
        state.collapseMode = next;
        // No syncMarkers — pure Vue state read by ContextWidget on toggle.
        if (bootCompleted && changed) {
          pushToast(describeCollapseMode(next), {
            severity: "info",
            singletonKey: "wp-collapse-mode",
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
    // Accessibility — motion + contrast. Lives under Display section
    // (instead of a dedicated Accessibility section as before) so the
    // playground launcher can stay first in the WP tab. The settings
    // panel still renders these as combos; the playground modal
    // mirrors them in its A11y section so users see effects live.
    //
    // Use newVal directly — extensionManager.setting.get() can lag the
    // onChange fire by a tick, which delayed the marker swap until a
    // page reload in the live UI. Toast feedback is gated on
    // `bootCompleted` so ComfyUI's load-fire (with the stored value)
    // doesn't pop a toast every refresh, and uses singletonKey so
    // rapid dropdown clicks replace the existing toast in place.
    {
      id: SETTING_ID_REDUCE_MOTION,
      name: "Reduce motion",
      type: "combo",
      options: MOTION_OPTIONS,
      defaultValue: "auto",
      tooltip:
        "Disables Wildcard Pipeline animations. " +
        "Match system honors prefers-reduced-motion.",
      category: ["Wildcard Pipeline", "Display", "Reduce motion"],
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
        "Bumps borders + text contrast. " +
        "Match system honors prefers-contrast.",
      category: ["Wildcard Pipeline", "Display", "Contrast"],
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
    // ── Behavior axes (Phase 2) ──────────────────────────────────
    // Live in their own "Behavior" section so users browsing the
    // panel can scan visual axes (Display) separately from runtime
    // gates (Behavior). Section sorts after Display alphabetically.
    {
      id: SETTING_ID_VALIDATION,
      name: "Validation strictness",
      type: "combo",
      options: VALIDATION_OPTIONS,
      defaultValue: "strict",
      tooltip:
        "How aggressively the conflict scanner surfaces issues. " +
        "Permissive turns it off — use only if you know what you're doing.",
      category: ["Wildcard Pipeline", "Behavior", "Validation"],
      onChange: (newVal) => {
        const next = asValidation(newVal, "strict");
        const changed = next !== state.validation;
        state.validation = next;
        if (bootCompleted && changed) {
          pushToast(describeValidation(next), {
            severity: next === "permissive" ? "warning" : "info",
            singletonKey: "wp-validation",
          });
        }
      },
    },
    {
      id: SETTING_ID_TOAST_LIFETIME,
      name: "Toast lifetime",
      type: "combo",
      options: TOAST_LIFETIME_OPTIONS,
      defaultValue: "default",
      tooltip: "How long status toasts stay on screen before auto-dismissing.",
      category: ["Wildcard Pipeline", "Behavior", "Toast lifetime"],
      onChange: (newVal) => {
        const next = asToastLifetime(newVal, "default");
        const changed = next !== state.toastLifetime;
        state.toastLifetime = next;
        if (bootCompleted && changed) {
          pushToast(describeToastLifetime(next), {
            severity: "info",
            singletonKey: "wp-toast-lifetime",
          });
        }
      },
    },
    {
      id: SETTING_ID_SUPPRESS_INFO,
      name: "Suppress info-severity toasts",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "When on, info toasts (status confirmations) are filtered out. " +
        "Warnings + errors still show.",
      category: ["Wildcard Pipeline", "Behavior", "Suppress info toasts"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.suppressInfoToasts;
        state.suppressInfoToasts = next;
        if (bootCompleted && changed) {
          // This toast is allowed to show even when suppressing info,
          // because the user just chose the suppression — they need
          // confirmation. Use warning severity so it bypasses any
          // filter logic that reads state lazily.
          pushToast(describeSuppressInfo(next), {
            severity: "warning",
            singletonKey: "wp-suppress-info",
          });
        }
      },
    },
    {
      id: SETTING_ID_NEW_DISABLED,
      name: "New modules start disabled",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "When on, modules added from the picker start with their toggle off. " +
        "Useful when configuring before letting them run.",
      category: ["Wildcard Pipeline", "Behavior", "New module default"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.newModuleDisabled;
        state.newModuleDisabled = next;
        if (bootCompleted && changed) {
          pushToast(describeNewModuleDisabled(next), {
            severity: "info",
            singletonKey: "wp-new-module-disabled",
          });
        }
      },
    },
  ];
}
