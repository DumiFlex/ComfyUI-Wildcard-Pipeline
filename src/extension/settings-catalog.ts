/**
 * The plain (combo / boolean) canvas settings, as data.
 *
 * `settings.ts` registers these with ComfyUI and owns what happens when one
 * changes. This module only describes them, and imports nothing, so the
 * manager SPA can render the same settings on its own Settings page (and
 * write them back through ComfyUI's settings API) without pulling the canvas
 * CSS, toast store and handlers into its bundle.
 *
 * `settings.test.ts` asserts every entry here matches what `buildSettings()`
 * registers, so the two cannot drift.
 */

export interface SettingOption { text: string; value: string }

export const SETTING_ID_REDUCE_MOTION = "wildcardPipeline.a11y.reduceMotion";
export const SETTING_ID_HIGH_CONTRAST = "wildcardPipeline.a11y.contrast";
export const SETTING_ID_DENSITY = "wildcardPipeline.display.density";
export const SETTING_ID_DECORATION = "wildcardPipeline.display.decoration";
export const SETTING_ID_INDICATOR = "wildcardPipeline.display.indicatorStyle";
export const SETTING_ID_BORDER = "wildcardPipeline.display.borderHighlight";
export const SETTING_ID_COLLAPSED = "wildcardPipeline.display.collapsedByDefault";
export const SETTING_ID_FOCUS = "wildcardPipeline.display.focusMode";
export const SETTING_ID_KIND_STYLE = "wildcardPipeline.display.kindStyle";
export const SETTING_ID_COLLAPSE_MODE = "wildcardPipeline.display.collapseMode";
export const SETTING_ID_COLOR_INTENSITY = "wildcardPipeline.display.colorIntensity";

export const SETTING_ID_VALIDATION = "wildcardPipeline.behavior.validation";
export const SETTING_ID_TOAST_LIFETIME = "wildcardPipeline.behavior.toastLifetime";
export const SETTING_ID_SUPPRESS_INFO = "wildcardPipeline.behavior.suppressInfoToasts";
export const SETTING_ID_NEW_DISABLED = "wildcardPipeline.behavior.newModuleDisabled";
export const SETTING_ID_CONFIRM_DESTRUCTIVE_BUNDLE = "wildcardPipeline.behavior.confirmDestructiveBundle";
export const SETTING_ID_BUNDLE_MASTER_OFF_BEHAVIOR = "wildcardPipeline.behavior.bundleMasterOffBehavior";
export const SETTING_ID_BUNDLE_COLLAPSED = "wildcardPipeline.display.bundleCollapsedByDefault";

export const MOTION_OPTIONS = [
  { text: "Match system (prefers-reduced-motion)", value: "auto" },
  { text: "Always reduce", value: "on" },
  { text: "Always allow", value: "off" },
];

export const CONTRAST_OPTIONS = [
  { text: "Match system (prefers-contrast)", value: "auto" },
  { text: "High contrast", value: "on" },
  { text: "Standard", value: "off" },
];

export const DENSITY_OPTIONS = [
  { text: "Comfortable (default)", value: "comfortable" },
  { text: "Compact", value: "compact" },
  { text: "Minimal", value: "minimal" },
];

export const DECORATION_OPTIONS = [
  { text: "Full (default)", value: "full" },
  { text: "Minimal", value: "minimal" },
  { text: "Off (flat)", value: "off" },
];

export const INDICATOR_OPTIONS = [
  { text: "Badge (default)", value: "badge" },
  { text: "Dot (compact)", value: "dot" },
  { text: "Both (verbose)", value: "both" },
];

export const KIND_STYLE_OPTIONS = [
  { text: "Chip (default)", value: "chip" },
  { text: "Icon (compact)", value: "icon" },
  { text: "Both (verbose)", value: "both" },
];

export const VALIDATION_OPTIONS = [
  { text: "Strict (show all conflicts)", value: "strict" },
  { text: "Relaxed (hide info-level overrides)", value: "relaxed" },
  { text: "Permissive (scanner off — no warnings)", value: "permissive" },
];

export const TOAST_LIFETIME_OPTIONS = [
  { text: "Short (3 s)", value: "short" },
  { text: "Default (5 s)", value: "default" },
  { text: "Long (10 s)", value: "long" },
  { text: "Sticky (no auto-dismiss)", value: "sticky" },
];

export const COLLAPSE_MODE_OPTIONS = [
  { text: "Independent (default)", value: "independent" },
  { text: "Accordion (expanding one collapses siblings)", value: "accordion" },
];

export const COLOR_INTENSITY_OPTIONS = [
  { text: "Muted (low saturation)", value: "muted" },
  { text: "Standard (default)", value: "standard" },
  { text: "Vivid (high saturation)", value: "vivid" },
];


export const BUNDLE_MASTER_OFF_OPTIONS = [
  { text: "Preserve manual (recommended)", value: "preserve-manual" },
  { text: "Cascade — clear everyone", value: "cascade-all" },
];

export const SETTING_ID_AC_MAX_SUGGESTIONS = "wildcardPipeline.behavior.autocompleteMaxSuggestions";
export const SETTING_ID_AC_MIN_CHARS = "wildcardPipeline.behavior.autocompleteMinChars";

export const AC_MAX_SUGGESTIONS_OPTIONS = [
  { text: "5", value: "5" },
  { text: "10", value: "10" },
  { text: "20 (default)", value: "20" },
  { text: "40", value: "40" },
];

export const AC_MIN_CHARS_OPTIONS = [
  { text: "1", value: "1" },
  { text: "2", value: "2" },
  { text: "3 (default)", value: "3" },
  { text: "4", value: "4" },
];

/** Where a setting sits on the manager's Canvas section. */
export type CanvasSettingGroup = "look" | "behavior" | "accessibility" | "feedback";

export interface CanvasSettingMeta {
  id: string;
  name: string;
  type: "combo" | "boolean";
  defaultValue: string | boolean;
  tooltip: string;
  options?: SettingOption[];
  group: CanvasSettingGroup;
}

/**
 * Every plain canvas setting, in the order the manager shows them. The custom
 * rendered ones (the playground launcher, the three completion sources with
 * their status line) are not here: the manager has its own UI for those.
 */
export const CANVAS_SETTINGS: CanvasSettingMeta[] = [
  { id: SETTING_ID_DENSITY, name: "Module density", type: "combo", options: DENSITY_OPTIONS, defaultValue: "comfortable",
    tooltip: "Module spacing and chip sizes.", group: "look" },
  { id: SETTING_ID_DECORATION, name: "Decoration", type: "combo", options: DECORATION_OPTIONS, defaultValue: "full",
    tooltip: "Gradients & shadows. Off = flat (weak GPU / remote desktop).", group: "look" },
  { id: SETTING_ID_COLOR_INTENSITY, name: "Color intensity", type: "combo", options: COLOR_INTENSITY_OPTIONS, defaultValue: "standard",
    tooltip: "How saturated accent / kind / status colors render. Muted reduces chroma for a calmer palette; vivid bumps it for pop.", group: "look" },
  { id: SETTING_ID_KIND_STYLE, name: "Type style", type: "combo", options: KIND_STYLE_OPTIONS, defaultValue: "chip",
    tooltip: "How the kind indicator shows on module rows AND bundle headers: chip text, icon glyph, or both.", group: "look" },
  { id: SETTING_ID_INDICATOR, name: "State indicator style", type: "combo", options: INDICATOR_OPTIONS, defaultValue: "badge",
    tooltip: "How mod / missing / drift / conflict markers appear.", group: "look" },
  { id: SETTING_ID_BORDER, name: "State border highlights", type: "boolean", defaultValue: true,
    tooltip: "Color the module border by its state.", group: "look" },
  { id: SETTING_ID_COLLAPSED, name: "Collapse new modules by default", type: "boolean", defaultValue: false,
    tooltip: "Modules added via the picker render with body hidden (header only). Bundles have their own setting below.", group: "behavior" },
  { id: SETTING_ID_BUNDLE_COLLAPSED, name: "Collapse new bundles by default", type: "boolean", defaultValue: false,
    tooltip: "Bundles inserted from the library render with the frame collapsed (header only). Independent from the modules collapse-default since bundles usually carry 3-8 children and users often want a different default there.", group: "behavior" },
  { id: SETTING_ID_COLLAPSE_MODE, name: "Collapse stack mode", type: "combo", options: COLLAPSE_MODE_OPTIONS, defaultValue: "independent",
    tooltip: "Independent: each module collapses on its own. Accordion: expanding a module collapses all others.", group: "behavior" },
  { id: SETTING_ID_FOCUS, name: "Focus mode", type: "boolean", defaultValue: false,
    tooltip: "Hover a module to dim the others.", group: "behavior" },
  { id: SETTING_ID_NEW_DISABLED, name: "New modules start disabled", type: "boolean", defaultValue: false,
    tooltip: "When on, modules added from the picker start with their toggle off. Useful when configuring before letting them run.", group: "behavior" },
  { id: SETTING_ID_CONFIRM_DESTRUCTIVE_BUNDLE, name: "Confirm destructive bundle actions", type: "boolean", defaultValue: true,
    tooltip: "Show a confirm dialog before remove / reset-to-library / save-to-library on bundles. Turn off if you trust the Undo toast as the only safety net.", group: "behavior" },
  { id: SETTING_ID_BUNDLE_MASTER_OFF_BEHAVIOR, name: "Bundle master toggle: clear behavior", type: "combo", options: BUNDLE_MASTER_OFF_OPTIONS, defaultValue: "preserve-manual",
    tooltip: "What the bundle master ON->OFF click clears. Preserve manual: only revert rows the master itself turned on; rows the user marked internal / locked individually stay put. Cascade: clear every applicable row regardless of how it got set. Applicability (skip constraint for internal, skip non-lockable for lock) is hardcoded — the engine ignores the flag on those kinds, so writing it would be dead data.", group: "behavior" },
  { id: SETTING_ID_VALIDATION, name: "Validation strictness", type: "combo", options: VALIDATION_OPTIONS, defaultValue: "strict",
    tooltip: "How aggressively the conflict scanner surfaces issues. Permissive turns it off — use only if you know what you're doing.", group: "feedback" },
  { id: SETTING_ID_TOAST_LIFETIME, name: "Toast lifetime", type: "combo", options: TOAST_LIFETIME_OPTIONS, defaultValue: "default",
    tooltip: "How long status toasts stay on screen before auto-dismissing.", group: "feedback" },
  { id: SETTING_ID_SUPPRESS_INFO, name: "Suppress info-severity toasts", type: "boolean", defaultValue: false,
    tooltip: "When on, info toasts (status confirmations) are filtered out. Warnings + errors still show.", group: "feedback" },
  { id: SETTING_ID_REDUCE_MOTION, name: "Reduce motion", type: "combo", options: MOTION_OPTIONS, defaultValue: "auto",
    tooltip: "Disables Wildcard Pipeline animations. Match system honors prefers-reduced-motion.", group: "accessibility" },
  { id: SETTING_ID_HIGH_CONTRAST, name: "Contrast", type: "combo", options: CONTRAST_OPTIONS, defaultValue: "auto",
    tooltip: "Bumps borders + text contrast. Match system honors prefers-contrast.", group: "accessibility" },
];

/** Same-origin channel the manager uses to hand a changed canvas setting to
 *  any open canvas tab, which applies it live through ComfyUI's own store. */
export const CANVAS_SETTINGS_CHANNEL = "wp-canvas-settings";

export interface CanvasSettingMessage { id: string; value: unknown }
