// Singleton state for the Display Playground modal.
//
// The modal is mounted once at extension boot (mirrors the Toast
// singleton pattern in main.ts). Opening + closing is driven by the
// reactive `playgroundOpen` ref. The launcher button registered in
// `buildSettings()` flips this ref to true; the modal's close handler
// flips it back.
//
// Setting writes go through `app.extensionManager.setting.set(id, val)`
// — that's the same API the ComfyUI settings panel uses, so our
// registered onChange handlers fire and sync state + toast feedback
// without us re-implementing any of that. Single source of truth.

import { ref } from "vue";
import type { app as comfyApp } from "#comfyui/app";

type AppLike = typeof comfyApp;

export const playgroundOpen = ref(false);

let appRef: AppLike | null = null;

/**
 * Capture the ComfyUI app singleton at boot so the playground can
 * read/write settings without re-importing the comfyui module
 * (which is mocked in tests).
 */
export function setComfyApp(app: AppLike): void {
  appRef = app;
}

export function openPlayground(): void {
  playgroundOpen.value = true;
}

export function closePlayground(): void {
  playgroundOpen.value = false;
}

/** Display-prefs setting key — last segment of the dotted ID. */
export type DisplayKey =
  | "density"
  | "decoration"
  | "indicatorStyle"
  | "kindStyle"
  | "borderHighlight"
  | "collapsedByDefault"
  | "focusMode";

/** A11y setting key — last segment of the dotted ID. */
export type A11yKey = "reduceMotion" | "contrast";

/** Behavior setting key — runtime-gating axes (Phase 2). */
export type BehaviorKey =
  | "validation"
  | "toastLifetime"
  | "suppressInfoToasts"
  | "newModuleDisabled";

export type SettingKey = DisplayKey | A11yKey | BehaviorKey;

const A11Y_KEYS = new Set<string>(["reduceMotion", "contrast"]);
const BEHAVIOR_KEYS = new Set<string>([
  "validation",
  "toastLifetime",
  "suppressInfoToasts",
  "newModuleDisabled",
]);

function settingId(key: SettingKey): string {
  // Three namespaces match the buildSettings registration in
  // settings.ts. Keep this routing in sync if a new key is added.
  if (A11Y_KEYS.has(key)) return `wildcardPipeline.a11y.${key}`;
  if (BEHAVIOR_KEYS.has(key)) return `wildcardPipeline.behavior.${key}`;
  return `wildcardPipeline.display.${key}`;
}

/** Read current stored value for a setting (undefined if not set). */
export function getSettingValue(key: SettingKey): unknown {
  return appRef?.extensionManager?.setting?.get(settingId(key));
}

/**
 * Persist a new value via ComfyUI's settings store. Triggers the
 * registered onChange handler in `buildSettings()`, which already
 * handles state map updates, body-class flips, and toast feedback.
 *
 * No-op if `setComfyApp` was never called (test harness path) or
 * the running ComfyUI build is too old to expose `setting.set`
 * (added in v1.33+).
 */
export function applySetting(key: SettingKey, value: unknown): void {
  appRef?.extensionManager?.setting?.set?.(settingId(key), value);
}

/** Test-only: reset the captured app reference so each test starts clean. */
export function _resetForTesting(): void {
  appRef = null;
  playgroundOpen.value = false;
}
