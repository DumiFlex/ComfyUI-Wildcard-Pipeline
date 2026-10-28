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
// Canvas theme tokens + shared `.wp-*` classes. Loaded ONCE here, in the boot
// chunk; SFCs never `@import` it (every copy used to land in its own lazy
// chunk, 15 copies in all). Comes first so the sheets below can override it.
import "../components/shared/theme.css";
import "../components/shared/a11y.css";
import "../components/shared/display-prefs.css";
import "../components/shared/vue-nodes.css";
// Rich-text inline-syntax colours for canvas-mounted RichTextInput/Preview
// (the SPA's rich-text.css isn't loaded on the canvas — see the file header).
import "../components/shared/rich-text-canvas.css";
import { pushToast } from "../components/shared/toast-store";
import { notifyCompletionSettingsChanged } from "../manager/utils/tagSetting";
import { openPlayground } from "../components/settings/playground-store";
import {
  SETTING_ID_REDUCE_MOTION,
  SETTING_ID_HIGH_CONTRAST,
  SETTING_ID_DENSITY,
  SETTING_ID_DECORATION,
  SETTING_ID_INDICATOR,
  SETTING_ID_BORDER,
  SETTING_ID_COLLAPSED,
  SETTING_ID_FOCUS,
  SETTING_ID_ROW_ACTIONS,
  SETTING_ID_KIND_STYLE,
  SETTING_ID_COLLAPSE_MODE,
  SETTING_ID_COLOR_INTENSITY,
  SETTING_ID_VALIDATION,
  SETTING_ID_TOAST_LIFETIME,
  SETTING_ID_SUPPRESS_INFO,
  SETTING_ID_NEW_DISABLED,
  SETTING_ID_IMAGE_FILTER_SOUND,
  SETTING_ID_IMAGE_FILTER_NOTIFY,
  SETTING_ID_CONFIRM_DESTRUCTIVE_BUNDLE,
  SETTING_ID_BUNDLE_MASTER_OFF_BEHAVIOR,
  SETTING_ID_BUNDLE_COLLAPSED,
  MOTION_OPTIONS,
  CONTRAST_OPTIONS,
  DENSITY_OPTIONS,
  DECORATION_OPTIONS,
  INDICATOR_OPTIONS,
  KIND_STYLE_OPTIONS,
  VALIDATION_OPTIONS,
  TOAST_LIFETIME_OPTIONS,
  COLLAPSE_MODE_OPTIONS,
  ROW_ACTIONS_OPTIONS,
  COLOR_INTENSITY_OPTIONS,
  BUNDLE_MASTER_OFF_OPTIONS,
  SETTING_ID_AC_TAGS,
  SETTING_ID_AC_LORA,
  SETTING_ID_AC_EMBEDDING,
  SETTING_ID_AC_SEPARATOR,
  SETTING_ID_AC_MAX_SUGGESTIONS,
  SETTING_ID_AC_MIN_CHARS,
  SETTING_ID_AC_SPACES,
  SETTING_ID_AC_ESCAPE,
  AC_MAX_SUGGESTIONS_OPTIONS,
  AC_MIN_CHARS_OPTIONS,
  CANVAS_SETTINGS_CHANNEL,
  type CanvasSettingMessage,
} from "./settings-catalog";


export type A11yMode = "auto" | "on" | "off";
export type Density = "comfortable" | "compact" | "minimal";
export type Decoration = "full" | "minimal" | "off";
export type IndicatorStyle = "both" | "badge" | "dot";
export type KindStyle = "both" | "icon" | "chip";
export type ValidationMode = "strict" | "relaxed" | "permissive";
export type ToastLifetime = "short" | "default" | "long" | "sticky";
export type CollapseMode = "independent" | "accordion";
export type RowActions = "always" | "hover";
export type ColorIntensity = "muted" | "standard" | "vivid";
export type BundleMasterOffBehavior = "preserve-manual" | "cascade-all";

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

/**
 * A switch drawn exactly like the one ComfyUI renders for a plain
 * `type: "boolean"` setting.
 *
 * Only needed because the three autocomplete rows cannot be plain booleans:
 * they show a count beside the switch, and the tag row disables itself when no
 * tag list is installed. Every other setting we own uses the real thing.
 *
 * The geometry is copied from the frontend's own `Switch.vue` (reka-ui
 * SwitchRoot + Tailwind): a 40x24 hit box holding a 36x20 track with 2px side
 * padding and a 16px shadowed thumb that travels 14px. The colours read the
 * same theme tokens its Tailwind classes resolve to (`--border-default` off,
 * `--primary-background` on, `--base-background` thumb), so the row follows a
 * theme switch like its neighbours. Older frontends drew a PrimeVue
 * ToggleSwitch instead, so each colour falls back to its `--p-toggleswitch-*`
 * token, then to a literal.
 *
 * Inline styles, not the frontend's class names: those are build output, and
 * borrowing them buys a perfect match today and a blank control the day they
 * restyle.
 */
const SWITCH_OFF = "var(--border-default, var(--p-toggleswitch-background, #3c3c3c))";
const SWITCH_ON = "var(--primary-background, var(--p-toggleswitch-checked-background, #0b8ce9))";
const SWITCH_THUMB = "var(--base-background, var(--p-toggleswitch-handle-background, #171718))";
const SWITCH_EASE = "150ms cubic-bezier(0.4, 0, 0.2, 1)";

export function buildSwitch(initial: boolean): {
  root: HTMLElement;
  setOn: (on: boolean) => void;
  setDisabled: (off: boolean) => void;
} {
  let on = initial;
  let disabled = false;

  const root = document.createElement("span");
  root.setAttribute("role", "switch");
  root.tabIndex = 0;
  const track = document.createElement("span");
  const thumb = document.createElement("span");
  track.appendChild(thumb);
  root.appendChild(track);

  // Static styling is written ONCE. Rewriting `cssText` on every change
  // replaces the `transition` declaration mid-flight, so the thumb would
  // teleport instead of sliding. Only what changes is touched below.
  root.style.cssText = [
    "display:inline-flex", "align-items:center", "justify-content:center",
    "flex:0 0 auto", "box-sizing:border-box",
    "width:40px", "height:24px", "padding:0", "border-radius:9999px",
    "touch-action:manipulation", "outline:none",
    `transition:box-shadow ${SWITCH_EASE}`,
  ].join(";");
  track.style.cssText = [
    "pointer-events:none", "display:inline-flex", "align-items:center",
    "box-sizing:border-box", "width:36px", "height:20px", "padding:0 2px",
    "border:1px solid transparent", "border-radius:9999px",
    `transition:background-color ${SWITCH_EASE}`,
  ].join(";");
  thumb.style.cssText = [
    "pointer-events:none", "display:block", "width:16px", "height:16px",
    "border-radius:9999px", `background:${SWITCH_THUMB}`,
    "box-shadow:0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a",
    `transition:transform ${SWITCH_EASE}`,
  ].join(";");

  const paint = (): void => {
    root.setAttribute("aria-checked", on ? "true" : "false");
    root.dataset.state = on ? "checked" : "unchecked";
    root.setAttribute("aria-disabled", disabled ? "true" : "false");
    track.style.background = on ? SWITCH_ON : SWITCH_OFF;
    thumb.style.transform = on ? "translateX(14px)" : "translateX(0)";
    root.style.opacity = disabled ? "0.5" : "1";
    root.style.cursor = disabled ? "not-allowed" : "pointer";
  };
  paint();

  // The native switch rings only on keyboard focus (`focus-visible:ring-1`).
  root.addEventListener("focus", () => {
    if (root.matches(":focus-visible")) root.style.boxShadow = `0 0 0 1px ${SWITCH_OFF}`;
  });
  root.addEventListener("blur", () => { root.style.boxShadow = ""; });

  const toggle = (): void => {
    if (disabled) return;
    on = !on;
    paint();
    root.dispatchEvent(new CustomEvent("wp-switch", { detail: on, bubbles: true }));
  };
  root.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
  root.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
  });

  return {
    root,
    setOn: (next) => { on = next; paint(); },
    setDisabled: (next) => { disabled = next; paint(); },
  };
}

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
  /** When a module row shows its lock / internal / remove buttons. */
  rowActions: RowActions;
  kindStyle: KindStyle;
  validation: ValidationMode;
  toastLifetime: ToastLifetime;
  suppressInfoToasts: boolean;
  newModuleDisabled: boolean;
  /** Chime when WP Image Filter starts waiting (default on). */
  imageFilterSound: boolean;
  /** System notification when WP Image Filter waits in a background tab. */
  imageFilterNotify: boolean;
  collapseMode: CollapseMode;
  colorIntensity: ColorIntensity;
  /** When true, destructive bundle ops (remove / reset-to-library /
   *  save-to-library) prompt via the themed ConfirmDialog before
   *  committing. When false, the op runs immediately and falls back
   *  to the toast Undo for recovery. */
  confirmDestructiveBundle: boolean;
  /** When true, bundles inserted from the library start with their
   *  `collapsed` flag set so the frame renders header-only. Companion
   *  to `collapsedByDefault` (modules) — kept separate because bundles
   *  are usually 3-8 children deep and users tend to want a different
   *  default for them than for individual modules. */
  bundleCollapsedByDefault: boolean;
  /** Master-OFF cascade behaviour. "preserve-manual" — only revert
   *  rows the master itself turned on (tracked via `_ui.master_*`
   *  markers); rows the user marked individually keep their state.
   *  "cascade-all" — clear every applicable row regardless of marker
   *  (full sweep). Applicability filter (skip constraint for
   *  internal, skip non-lockable for lock) is hardcoded and not
   *  user-configurable — writing those flags onto kinds that don't
   *  surface them is dead data and would only confuse downstream
   *  tooling. */
  bundleMasterOffBehavior: BundleMasterOffBehavior;
}>({
  reduceMotion: "auto",
  contrast: "auto",
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  borderHighlight: true,
  collapsedByDefault: false,
  focusMode: false,
  rowActions: "always",
  kindStyle: "chip",
  validation: "strict",
  toastLifetime: "default",
  suppressInfoToasts: false,
  newModuleDisabled: false,
  imageFilterSound: true,
  imageFilterNotify: false,
  collapseMode: "independent",
  colorIntensity: "standard",
  confirmDestructiveBundle: true,
  bundleMasterOffBehavior: "preserve-manual",
  bundleCollapsedByDefault: false,
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

function asRowActions(v: unknown, fallback: RowActions): RowActions {
  return v === "always" || v === "hover" ? v : fallback;
}

function asColorIntensity(v: unknown, fallback: ColorIntensity): ColorIntensity {
  return v === "muted" || v === "standard" || v === "vivid" ? v : fallback;
}

function asBundleMasterOffBehavior(
  v: unknown,
  fallback: BundleMasterOffBehavior,
): BundleMasterOffBehavior {
  return v === "preserve-manual" || v === "cascade-all" ? v : fallback;
}

/** Test-only: reset display preferences state to defaults. */
export function _resetDisplayStateForTesting(): void {
  state.density = "comfortable";
  state.decoration = "full";
  state.indicatorStyle = "badge";
  state.borderHighlight = true;
  state.collapsedByDefault = false;
  state.focusMode = false;
  state.rowActions = "always";
  state.kindStyle = "chip";
  state.validation = "strict";
  state.toastLifetime = "default";
  state.suppressInfoToasts = false;
  state.newModuleDisabled = false;
  state.imageFilterSound = true;
  state.imageFilterNotify = false;
  state.collapseMode = "independent";
  state.colorIntensity = "standard";
  // Tests default to skipping the confirm dialog so the existing
  // ctxmenu-driven destructive-op suites don't have to thread a click
  // through a Promise. Production default is `true` (set in the
  // top-level reactive() initialiser + the buildSettings entry's
  // defaultValue); this reset is test-scoped.
  state.confirmDestructiveBundle = false;
  state.bundleMasterOffBehavior = "preserve-manual";
  state.bundleCollapsedByDefault = false;
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

/** The conflicts the Validation strictness setting lets through: all of them
 *  (strict), all but info (relaxed), none (permissive). Every place that
 *  shows conflicts (node rows, subgraph badges) filters through this. */
export function filterByValidation<T extends { severity: string }>(conflicts: T[]): T[] {
  return filterForValidation(state.validation, conflicts);
}

/** `filterByValidation` for a given mode (the playground previews a mode). */
export function filterForValidation<T extends { severity: string }>(mode: ValidationMode, conflicts: T[]): T[] {
  if (mode === "permissive") return [];
  if (mode === "relaxed") return conflicts.filter((c) => c.severity !== "info");
  return conflicts;
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

/** Whether WP Image Filter chimes when it starts waiting for a pick. */
export function shouldPlayImageFilterSound(): boolean {
  return state.imageFilterSound;
}

/** Whether WP Image Filter shows a system notification while it waits. */
export function shouldNotifyImageFilter(): boolean {
  return state.imageFilterNotify;
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
export function getConfirmDestructiveBundle(): boolean {
  return state.confirmDestructiveBundle;
}

export function getBundleMasterOffBehavior(): BundleMasterOffBehavior {
  return state.bundleMasterOffBehavior;
}

export function getBundleCollapsedByDefault(): boolean {
  return state.bundleCollapsedByDefault;
}

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

function describeColorIntensity(mode: ColorIntensity): string {
  return `Color intensity: ${mode.toUpperCase()}`;
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

  // Display — row buttons only on hover (pressed ones stay; display-prefs.css)
  document.body.classList.toggle("wp-row-actions-hover", state.rowActions === "hover");

  // Display — kind style (module type icon vs chip vs both)
  document.body.classList.toggle("wp-kind-style-icon", state.kindStyle === "icon");
  document.body.classList.toggle("wp-kind-style-chip", state.kindStyle === "chip");
  document.body.classList.toggle("wp-kind-style-both", state.kindStyle === "both");

  // Display — color intensity (overrides accent / kind / status tokens
  // via oklch() chroma multipliers; see display-prefs.css)
  document.body.classList.toggle("wp-color-muted", state.colorIntensity === "muted");
  document.body.classList.toggle("wp-color-standard", state.colorIntensity === "standard");
  document.body.classList.toggle("wp-color-vivid", state.colorIntensity === "vivid");
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
  state.rowActions = asRowActions(app.extensionManager?.setting?.get(SETTING_ID_ROW_ACTIONS), "always");
  state.kindStyle = asKindStyle(app.extensionManager?.setting?.get(SETTING_ID_KIND_STYLE), "chip");
  // Phase 2 — behavior axes. None of these flip body classes (they
  // gate consumer logic in conflicts.ts / toast-store / ContextWidget
  // add path), but they read from the same store at boot.
  state.validation = asValidation(app.extensionManager?.setting?.get(SETTING_ID_VALIDATION), "strict");
  state.toastLifetime = asToastLifetime(app.extensionManager?.setting?.get(SETTING_ID_TOAST_LIFETIME), "default");
  state.suppressInfoToasts = app.extensionManager?.setting?.get(SETTING_ID_SUPPRESS_INFO) === true;
  state.newModuleDisabled = app.extensionManager?.setting?.get(SETTING_ID_NEW_DISABLED) === true;
  state.imageFilterSound = app.extensionManager?.setting?.get(SETTING_ID_IMAGE_FILTER_SOUND) !== false;
  state.imageFilterNotify = app.extensionManager?.setting?.get(SETTING_ID_IMAGE_FILTER_NOTIFY) === true;
  state.confirmDestructiveBundle =
    app.extensionManager?.setting?.get(SETTING_ID_CONFIRM_DESTRUCTIVE_BUNDLE) !== false;
  state.bundleMasterOffBehavior = asBundleMasterOffBehavior(
    app.extensionManager?.setting?.get(SETTING_ID_BUNDLE_MASTER_OFF_BEHAVIOR),
    "preserve-manual",
  );
  state.bundleCollapsedByDefault =
    app.extensionManager?.setting?.get(SETTING_ID_BUNDLE_COLLAPSED) === true;
  // Phase 3b — collapse-stack mode. Pure Vue state (no body class) since
  // the behavior is JS-driven (toggleCollapsed reads via getCollapseMode).
  state.collapseMode = asCollapseMode(app.extensionManager?.setting?.get(SETTING_ID_COLLAPSE_MODE), "independent");
  // Phase 3c — color intensity. Body class drives oklch() chroma
  // overrides for accent / kind / status tokens (see display-prefs.css).
  state.colorIntensity = asColorIntensity(app.extensionManager?.setting?.get(SETTING_ID_COLOR_INTENSITY), "standard");
  syncMarkers();
}

/**
 * Wire matchMedia listeners so "auto" mode reflects OS-level changes
 * without requiring a page reload (e.g. user toggles "Reduce motion" in
 * macOS System Settings while ComfyUI is open).
 */
interface SettingWriter {
  extensionManager?: { setting?: { set?: (id: string, value: unknown) => unknown } };
}

/**
 * Apply canvas settings the manager's Settings page changes, live.
 *
 * The manager is another tab on the same origin, so a BroadcastChannel reaches
 * every open canvas. Writing through ComfyUI's own store (rather than only
 * the settings API the manager also calls) fires the same `onChange` the
 * settings panel would, so markers and toasts update without a reload. Only
 * our own `wildcardPipeline.*` ids are accepted.
 */
export function listenForManagerSettings(app: SettingWriter): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CANVAS_SETTINGS_CHANNEL);
  channel.onmessage = (event: MessageEvent<CanvasSettingMessage>) => {
    const msg = event.data;
    if (!msg || typeof msg.id !== "string" || !msg.id.startsWith("wildcardPipeline.")) return;
    if (msg.source === "canvas") return;
    const set = app.extensionManager?.setting?.set;
    if (typeof set !== "function") return;
    try {
      void set(msg.id, msg.value);
    } catch {
      /* a rejected write leaves the old value, which is what the panel shows */
    }
  };
  return () => channel.close();
}

/**
 * Tell an open manager page that a canvas setting changed here (the other
 * half of `listenForManagerSettings`). Fire and forget: no manager open means
 * nobody listens, and the value is already saved by ComfyUI.
 */
export function announceCanvasSetting(id: string, value: unknown): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CANVAS_SETTINGS_CHANNEL);
  const msg: CanvasSettingMessage = { id, value, source: "canvas" };
  channel.postMessage(msg);
  channel.close();
}

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
    rowActions: (mode: RowActions) => { state.rowActions = mode; syncMarkers(); },
    kindStyle: (mode: KindStyle) => { state.kindStyle = mode; syncMarkers(); },
    // collapseMode is pure Vue state — no syncMarkers since it has
    // no body class. ContextWidget reads via getCollapseMode().
    collapseMode: (mode: CollapseMode) => { state.collapseMode = mode; },
    colorIntensity: (mode: ColorIntensity) => { state.colorIntensity = mode; syncMarkers(); },
    state: () => ({
      density: state.density,
      decoration: state.decoration,
      indicatorStyle: state.indicatorStyle,
      borderHighlight: state.borderHighlight,
      collapsedByDefault: state.collapsedByDefault,
      focusMode: state.focusMode,
      rowActions: state.rowActions,
      kindStyle: state.kindStyle,
      collapseMode: state.collapseMode,
      colorIntensity: state.colorIntensity,
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
  // renders entries in REVERSE array order within each section
  // (last in source = first in panel — verified empirically against
  // the live frontend, the registration store appears to render
  // bottom-up).
  //
  // Section names mirror the `<fieldset>` legends from
  // DisplayPlaygroundModal.vue so the panel and the modal show the
  // same buckets. Each section name is prefixed with a digit + dot
  // ("1. Playground", "2. Sizing", ...) so ComfyUI's alphabetical
  // sort lands them in the playground's logical order — without the
  // prefix, "Accessibility" / "Collapse & focus" / etc. would sort
  // by their natural letters and bury the launcher mid-list.
  //
  // 3rd-level category MUST be unique per setting. ComfyUI treats the
  // full `category` path as the setting's unique identifier — two
  // entries sharing the same 3-tuple collapse to a single row in the
  // panel (one wins, the other disappears).
  //
  // Source order below reads top-to-bottom in the SAME order users
  // see in the panel — playground first, sizing next, etc. The
  // `.reverse()` at the bottom of the function flips the literal
  // into ComfyUI's expected per-section render order so what we
  // write matches what users see.
  const entries: ComfySetting[] = [
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
      category: ["Wildcard Pipeline", "1. Playground", "Open"],
    },
    // Booru tag autocomplete — canvas half of the SPA setting, deliberately
    // separate. Someone may want suggestions in the full manager and not while
    // squinting at a node on a canvas, and a ComfyUI user looks for switches
    // here rather than in our SPA.
    //
    // Rendered by hand so it can DISABLE itself when no tag list is installed.
    // A plain boolean would happily switch on and do nothing, which is the
    // failure this whole feature keeps having to design around: a control that
    // implies a capability it does not have.
    {
      id: SETTING_ID_AC_TAGS,
      name: "Booru tag autocomplete",
      type: (_name, setter, value, _attrs) => {
        const wrap = document.createElement("label");
        wrap.style.cssText =
          "display:flex; align-items:center; justify-content:flex-end; gap:10px; cursor:pointer";
        const { root: box, setOn, setDisabled } = buildSwitch(value === true);
        const note = document.createElement("span");
        // NOTE FIRST, then the switch. Appended the other way round the control
        // floated mid-row while every neighbouring toggle sat flush right, and
        // a row that does not line up reads as broken before it reads as ours.
        note.style.cssText =
          "font-size: 12px; line-height: 1.3; color: var(--muted-foreground, var(--descrip-text, #999))";
        wrap.append(note, box);

        // Ask the server whether a list exists. Until it answers, leave the
        // control alone rather than flickering it disabled.
        void fetch("/wp/api/tags/status")
          .then((r) => r.json())
          .then((s: { available?: boolean; tag_count?: number }) => {
            if (s.available) {
              note.textContent = `${(s.tag_count ?? 0).toLocaleString()} tags installed`;
              return;
            }
            setOn(false);
            setDisabled(true);
            wrap.style.cursor = "not-allowed";
            wrap.title =
              "No tag list installed. Open the Wildcard Pipeline manager → "
              + "Settings → Tag autocomplete and press Download to enable this.";
            note.textContent = "No tag list — download one in the manager's Settings";
          })
          .catch(() => {
            note.textContent = "";
          });

        box.addEventListener("wp-switch", (e) => {
          setter((e as CustomEvent<boolean>).detail);
          // Editors read this straight out of ComfyUI's settings store, which
          // Vue cannot track — without the nudge the change took a page reload
          // to have any effect.
          notifyCompletionSettingsChanged();
        });
        return wrap;
      },
      defaultValue: false,
      tooltip:
        "Suggest danbooru tag names while typing in Wildcard Pipeline node "
        + "editors. Requires a tag list, installed from the manager's Settings. "
        + "Only affects this extension's own inputs.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Tag autocomplete"],
      // The switch's own handler nudges editors too; this covers a change
      // that arrives from the manager or the playground instead.
      onChange: () => notifyCompletionSettingsChanged(),
    },
    // The other two completion sources. Same hand-built control as the tag
    // setting above, for the same reason it exists: a count beside the switch.
    // "50 found" answers the question a bare toggle raises — is there anything
    // for this to suggest? — and it is the question that sends people to the
    // manager to check.
    ...(
      [
        { id: SETTING_ID_AC_LORA, name: "LoRA autocomplete",
          kind: "lora", noun: "LoRAs",
          tooltip:
            "Suggest installed LoRA names while typing in Wildcard Pipeline node "
            + "editors, inserting the full <lora:name:1.0> syntax. Reads the models "
            + "ComfyUI already knows about. Only affects this extension's own inputs." },
        { id: SETTING_ID_AC_EMBEDDING, name: "Embedding autocomplete",
          kind: "embedding", noun: "embeddings",
          tooltip:
            "Suggest installed embedding names while typing in Wildcard Pipeline "
            + "node editors, inserting the full embedding:name syntax. Reads the "
            + "models ComfyUI already knows about. Only affects this extension's "
            + "own inputs." },
      ] as const
    ).map((src) => ({
      id: src.id,
      name: src.name,
      type: ((_name: string, setter: (v: unknown) => void, value: unknown) => {
        const wrap = document.createElement("label");
        wrap.style.cssText =
          "display:flex; align-items:center; justify-content:flex-end; gap:10px; cursor:pointer";
        const { root: box } = buildSwitch(value === true);
        const note = document.createElement("span");
        note.style.cssText =
          "font-size: 12px; line-height: 1.3; color: var(--muted-foreground, var(--descrip-text, #999))";
        // Note first so the switch lands flush right, level with every
        // neighbouring row's control.
        wrap.append(note, box);

        void fetch("/wp/api/models/status")
          .then((r) => r.json())
          .then((s: { sources?: { kind: string; count: number }[] }) => {
            const count = (s.sources ?? []).find((x) => x.kind === src.kind)?.count ?? 0;
            note.textContent = count > 0
              ? `${count.toLocaleString()} ${src.noun} found`
              : `No ${src.noun} found`;
          })
          .catch(() => { note.textContent = ""; });

        box.addEventListener("wp-switch", (e) => {
          setter((e as CustomEvent<boolean>).detail);
          notifyCompletionSettingsChanged();
        });
        return wrap;
      }) as ComfySettingCustomRenderer,
      defaultValue: false,
      tooltip: src.tooltip,
      category: ["Wildcard Pipeline", "7. Runtime behavior", src.name],
      onChange: () => notifyCompletionSettingsChanged(),
    })),
    {
      id: SETTING_ID_AC_SEPARATOR,
      name: "Append \", \" after a completion",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "Insert a comma and a space after picking a suggestion, so the next tag "
        + "can be typed straight away. Never applied inside a <lora:…> or "
        + "embedding:… reference, where a comma would end the reference.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Autocomplete separator"],
      onChange: () => notifyCompletionSettingsChanged(),
    },
    {
      id: SETTING_ID_AC_SPACES,
      name: "Autocomplete: write tags with spaces",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "Write a picked tag with spaces instead of underscores (blue_hair → "
        + "blue hair). Short emoticon tags like ^_^ keep theirs.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Autocomplete spaces"],
      onChange: () => notifyCompletionSettingsChanged(),
    },
    {
      id: SETTING_ID_AC_ESCAPE,
      name: "Autocomplete: escape brackets in tags",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "Write the brackets in a picked tag as \\( and \\) (fate_(series) → "
        + "fate_\\(series\\)), so they are not read as a weight.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Autocomplete escape brackets"],
      onChange: () => notifyCompletionSettingsChanged(),
    },
    {
      id: SETTING_ID_AC_MAX_SUGGESTIONS,
      name: "Autocomplete: max suggestions",
      type: "combo",
      options: AC_MAX_SUGGESTIONS_OPTIONS,
      defaultValue: "20",
      tooltip: "How many tag suggestions the popup lists at most.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Autocomplete max suggestions"],
      onChange: () => notifyCompletionSettingsChanged(),
    },
    {
      id: SETTING_ID_AC_MIN_CHARS,
      name: "Autocomplete: minimum characters",
      type: "combo",
      options: AC_MIN_CHARS_OPTIONS,
      defaultValue: "3",
      tooltip:
        "Letters typed before tag suggestions appear. Lower shows them sooner, "
        + "at the cost of a popup on almost every keystroke.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Autocomplete minimum characters"],
      onChange: () => notifyCompletionSettingsChanged(),
    },
    // Visual axes — sizing, embellishment, identity
    {
      id: SETTING_ID_DENSITY,
      name: "Module density",
      type: "combo",
      options: DENSITY_OPTIONS,
      defaultValue: "comfortable",
      tooltip: "Module spacing and chip sizes.",
      category: ["Wildcard Pipeline", "2. Sizing", "Density"],
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
      category: ["Wildcard Pipeline", "2. Sizing", "Decoration"],
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
      id: SETTING_ID_COLOR_INTENSITY,
      name: "Color intensity",
      type: "combo",
      options: COLOR_INTENSITY_OPTIONS,
      defaultValue: "standard",
      tooltip:
        "How saturated accent / kind / status colors render. " +
        "Muted reduces chroma for a calmer palette; vivid bumps it for pop.",
      category: ["Wildcard Pipeline", "2. Sizing", "Color intensity"],
      onChange: (newVal) => {
        const next = asColorIntensity(newVal, "standard");
        const changed = next !== state.colorIntensity;
        state.colorIntensity = next;
        syncMarkers();
        if (bootCompleted && changed) {
          pushToast(describeColorIntensity(next), {
            severity: "info",
            singletonKey: "wp-color-intensity",
          });
        }
      },
    },
    {
      id: SETTING_ID_KIND_STYLE,
      name: "Type style",
      type: "combo",
      options: KIND_STYLE_OPTIONS,
      defaultValue: "chip",
      tooltip: "How the kind indicator shows on module rows AND bundle headers: chip text, icon glyph, or both.",
      category: ["Wildcard Pipeline", "3. Module identity", "Type style"],
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
      category: ["Wildcard Pipeline", "4. State markers", "State indicator style"],
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
      category: ["Wildcard Pipeline", "4. State markers", "State border highlights"],
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
      tooltip: "Modules added via the picker render with body hidden (header only). Bundles have their own setting below.",
      category: ["Wildcard Pipeline", "5. Collapse & focus", "Collapse modules default"],
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
      id: SETTING_ID_BUNDLE_COLLAPSED,
      name: "Collapse new bundles by default",
      type: "boolean",
      defaultValue: false,
      tooltip: "Bundles inserted from the library render with the frame collapsed (header only). Independent from the modules collapse-default since bundles usually carry 3-8 children and users often want a different default there.",
      category: ["Wildcard Pipeline", "5. Collapse & focus", "Collapse bundles default"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.bundleCollapsedByDefault;
        state.bundleCollapsedByDefault = next;
        if (bootCompleted && changed) {
          pushToast(
            next
              ? "New bundles will start collapsed."
              : "New bundles will start expanded.",
            { severity: "info", singletonKey: "wp-bundle-collapsed-default" },
          );
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
      category: ["Wildcard Pipeline", "5. Collapse & focus", "Collapse stack mode"],
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
      category: ["Wildcard Pipeline", "5. Collapse & focus", "Focus mode"],
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
    {
      id: SETTING_ID_ROW_ACTIONS,
      name: "Row buttons",
      type: "combo",
      options: ROW_ACTIONS_OPTIONS,
      defaultValue: "always",
      tooltip:
        "When a module row shows its lock, internal and remove buttons. On hover "
        + "keeps rows calmer; a pressed lock or internal button always shows.",
      category: ["Wildcard Pipeline", "5. Collapse & focus", "Row buttons"],
      onChange: (newVal) => {
        state.rowActions = asRowActions(newVal, "always");
        syncMarkers();
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
      category: ["Wildcard Pipeline", "6. Accessibility", "Reduce motion"],
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
      category: ["Wildcard Pipeline", "6. Accessibility", "Contrast"],
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
    // ── Runtime axes (Phase 2) ──────────────────────────────────
    // Section name "Runtime" (renamed from "Behavior" in Phase 3c+1)
    // sorts AFTER "Display" alphabetically (R > D), so the Display
    // section keeps its top slot in the panel and the Playground
    // launcher stays first. Behavior was the original name but
    // sorted before Display, pushing the launcher to second place.
    {
      id: SETTING_ID_VALIDATION,
      name: "Validation strictness",
      type: "combo",
      options: VALIDATION_OPTIONS,
      defaultValue: "strict",
      tooltip:
        "How aggressively the conflict scanner surfaces issues. " +
        "Permissive turns it off — use only if you know what you're doing.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Validation"],
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
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Toast lifetime"],
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
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Suppress info toasts"],
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
      id: SETTING_ID_IMAGE_FILTER_SOUND,
      name: "Image Filter sound",
      type: "boolean",
      defaultValue: true,
      tooltip: "Play a short chime when WP Image Filter is waiting for your pick, so you hear it from another tab.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Image Filter sound"],
      onChange: (newVal) => {
        state.imageFilterSound = newVal !== false;
      },
    },
    {
      id: SETTING_ID_IMAGE_FILTER_NOTIFY,
      name: "Image Filter desktop notification",
      type: "boolean",
      defaultValue: false,
      tooltip: "Show a system notification when WP Image Filter is waiting and this tab is in the background. Your browser asks for permission the first time.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Image Filter notification"],
      onChange: (newVal) => {
        state.imageFilterNotify = newVal === true;
        // Ask while the user is looking at the switch, not mid-run.
        const N = globalThis.Notification;
        if (state.imageFilterNotify && bootCompleted && N && N.permission === "default") {
          void N.requestPermission().catch(() => undefined);
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
      category: ["Wildcard Pipeline", "7. Runtime behavior", "New module default"],
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
    {
      id: SETTING_ID_CONFIRM_DESTRUCTIVE_BUNDLE,
      name: "Confirm destructive bundle actions",
      type: "boolean",
      defaultValue: true,
      tooltip:
        "Show a confirm dialog before remove / reset-to-library / " +
        "save-to-library on bundles. Turn off if you trust the Undo " +
        "toast as the only safety net.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Confirm destructive bundle"],
      onChange: (newVal) => {
        const next = newVal === true;
        const changed = next !== state.confirmDestructiveBundle;
        state.confirmDestructiveBundle = next;
        if (bootCompleted && changed) {
          pushToast(
            next
              ? "Confirm dialog will show for destructive bundle ops."
              : "Confirm dialog disabled — undo via the toast.",
            { severity: "info", singletonKey: "wp-confirm-destructive-bundle" },
          );
        }
      },
    },
    {
      id: SETTING_ID_BUNDLE_MASTER_OFF_BEHAVIOR,
      name: "Bundle master toggle: clear behavior",
      type: "combo",
      options: BUNDLE_MASTER_OFF_OPTIONS,
      defaultValue: "preserve-manual",
      tooltip:
        "What the bundle master ON->OFF click clears. " +
        "Preserve manual: only revert rows the master itself turned on; " +
        "rows the user marked internal / locked individually stay put. " +
        "Cascade: clear every applicable row regardless of how it got " +
        "set. Applicability (skip constraint for internal, " +
        "skip non-lockable for lock) is hardcoded — the engine ignores " +
        "the flag on those kinds, so writing it would be dead data.",
      category: ["Wildcard Pipeline", "7. Runtime behavior", "Bundle master clear behavior"],
      onChange: (newVal) => {
        const next = asBundleMasterOffBehavior(newVal, "preserve-manual");
        const changed = next !== state.bundleMasterOffBehavior;
        state.bundleMasterOffBehavior = next;
        if (bootCompleted && changed) {
          pushToast(
            next === "cascade-all"
              ? "Bundle master OFF will clear every applicable child."
              : "Bundle master OFF will only revert rows it turned on.",
            { severity: "info", singletonKey: "wp-bundle-master-off-behavior" },
          );
        }
      },
    },
  ];
  // Every change, from the panel, the playground or the manager, is
  // announced so an open manager page shows it without a refocus.
  for (const entry of entries) {
    if (entry.id === "wildcardPipeline.display._playground") continue;
    const inner = entry.onChange;
    entry.onChange = (newVal, oldVal) => {
      inner?.(newVal, oldVal);
      if (newVal !== oldVal) announceCanvasSetting(entry.id, newVal);
    };
  }
  // ComfyUI's settings panel renders entries in reverse array order
  // within a section. Reverse so what we wrote in logical top-to-bottom
  // order matches what the user sees in the panel.
  return entries.reverse();
}
