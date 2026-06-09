<script setup lang="ts">
/**
 * Display Playground modal — single-pane companion for the ComfyUI
 * Settings panel. Reachable via the launcher button at the top of
 * `Wildcard Pipeline → Display`.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  Display Playground                       ×  │
 *   ├──────────────────────┬───────────────────────┤
 *   │   [controls]         │   [live mockup]       │
 *   │   density            │                       │
 *   │   decoration         │   <module card>       │
 *   │   module type        │                       │
 *   │   indicator style    │                       │
 *   │   border highlights  │                       │
 *   │   collapse default   │                       │
 *   │   focus mode         │                       │
 *   ├──────────────────────┴───────────────────────┤
 *   │     [Reset all]               [Done]         │
 *   └──────────────────────────────────────────────┘
 *
 * Live binding: every control change calls `applySetting(key, value)`,
 * which routes to `app.extensionManager.setting.set(...)`. ComfyUI
 * fires the registered onChange — that handler updates our state map,
 * flips body markers (so the mockup AND the underlying canvas update
 * instantly), and emits a toast. No "Apply" button needed; closing
 * the modal just dismisses it, settings persist as you go.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  playgroundOpen,
  closePlayground,
  applySetting,
  getSettingValue,
  type SettingKey,
} from "./playground-store";
import PlaygroundMockup from "./PlaygroundMockup.vue";
import WpCheck from "@/components/shared/WpCheck.vue";

type Density = "comfortable" | "compact" | "minimal";
type Decoration = "full" | "minimal" | "off";
type IndicatorStyle = "both" | "badge" | "dot";
type KindStyle = "both" | "icon" | "chip";
type A11yMode = "auto" | "on" | "off";
type ValidationMode = "strict" | "relaxed" | "permissive";
type ToastLifetime = "short" | "default" | "long" | "sticky";
type CollapseMode = "independent" | "accordion";
type ColorIntensity = "muted" | "standard" | "vivid";
type BundleMasterOffBehavior = "preserve-manual" | "cascade-all";

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// Local refs mirror the stored setting values. We use plain refs (not
// computed) because the underlying source — extensionManager.setting.get
// — is NOT a Vue reactive value, so a computed getter wouldn't know
// when to re-evaluate. Instead, we resync from the store every time
// the modal opens (see watch(playgroundOpen) below) and write back via
// applySetting on every change. This guarantees the controls always
// reflect the latest persisted state, even after edits made via the
// native settings panel between modal opens.
const density = ref<Density>("comfortable");
const decoration = ref<Decoration>("full");
const indicatorStyle = ref<IndicatorStyle>("badge");
const kindStyle = ref<KindStyle>("chip");
const borderHighlight = ref<boolean>(true);
const collapsedByDefault = ref<boolean>(false);
const bundleCollapsedByDefault = ref<boolean>(false);
const collapseMode = ref<CollapseMode>("independent");
const colorIntensity = ref<ColorIntensity>("standard");
const focusMode = ref<boolean>(false);
const reduceMotion = ref<A11yMode>("auto");
const contrast = ref<A11yMode>("auto");
// Phase 2 — behavior axes
const validation = ref<ValidationMode>("strict");
const toastLifetime = ref<ToastLifetime>("default");
const suppressInfoToasts = ref<boolean>(false);
const newModuleDisabled = ref<boolean>(false);
const confirmDestructiveBundle = ref<boolean>(true);
const bundleMasterOffBehavior = ref<BundleMasterOffBehavior>("preserve-manual");

/**
 * Pull every value from the store into the local refs. Called on
 * every modal open so external changes (settings panel, OS prefs
 * change, another tab editing the same workflow) reflect immediately.
 */
function syncFromStore(): void {
  density.value = asString(getSettingValue("density"), "comfortable") as Density;
  decoration.value = asString(getSettingValue("decoration"), "full") as Decoration;
  indicatorStyle.value = asString(getSettingValue("indicatorStyle"), "badge") as IndicatorStyle;
  kindStyle.value = asString(getSettingValue("kindStyle"), "chip") as KindStyle;
  borderHighlight.value = asBool(getSettingValue("borderHighlight"), true);
  collapsedByDefault.value = asBool(getSettingValue("collapsedByDefault"), false);
  bundleCollapsedByDefault.value = asBool(getSettingValue("bundleCollapsedByDefault"), false);
  collapseMode.value = asString(getSettingValue("collapseMode"), "independent") as CollapseMode;
  colorIntensity.value = asString(getSettingValue("colorIntensity"), "standard") as ColorIntensity;
  focusMode.value = asBool(getSettingValue("focusMode"), false);
  reduceMotion.value = asString(getSettingValue("reduceMotion"), "auto") as A11yMode;
  contrast.value = asString(getSettingValue("contrast"), "auto") as A11yMode;
  validation.value = asString(getSettingValue("validation"), "strict") as ValidationMode;
  toastLifetime.value = asString(getSettingValue("toastLifetime"), "default") as ToastLifetime;
  suppressInfoToasts.value = asBool(getSettingValue("suppressInfoToasts"), false);
  newModuleDisabled.value = asBool(getSettingValue("newModuleDisabled"), false);
  confirmDestructiveBundle.value = asBool(getSettingValue("confirmDestructiveBundle"), true);
  bundleMasterOffBehavior.value = asString(
    getSettingValue("bundleMasterOffBehavior"),
    "preserve-manual",
  ) as BundleMasterOffBehavior;
}

// Per-ref watchers persist to extensionManager whenever a control
// flips. The onChange handler in buildSettings() short-circuits when
// `next === state.X` so syncFromStore's redundant writes (every open)
// are no-ops — no toast, no body class re-flip. Means we don't need
// a suppression flag; the change-detection lives one layer down where
// it already had to live for ComfyUI's load-fire suppression.
watch(density, (v) => applySetting("density", v));
watch(decoration, (v) => applySetting("decoration", v));
watch(indicatorStyle, (v) => applySetting("indicatorStyle", v));
watch(kindStyle, (v) => applySetting("kindStyle", v));
watch(borderHighlight, (v) => applySetting("borderHighlight", v));
watch(collapsedByDefault, (v) => applySetting("collapsedByDefault", v));
watch(bundleCollapsedByDefault, (v) => applySetting("bundleCollapsedByDefault", v));
watch(collapseMode, (v) => applySetting("collapseMode", v));
watch(colorIntensity, (v) => applySetting("colorIntensity", v));
watch(focusMode, (v) => applySetting("focusMode", v));
watch(reduceMotion, (v) => applySetting("reduceMotion", v));
watch(contrast, (v) => applySetting("contrast", v));
watch(validation, (v) => applySetting("validation", v));
watch(toastLifetime, (v) => applySetting("toastLifetime", v));
watch(suppressInfoToasts, (v) => applySetting("suppressInfoToasts", v));
watch(newModuleDisabled, (v) => applySetting("newModuleDisabled", v));
watch(confirmDestructiveBundle, (v) => applySetting("confirmDestructiveBundle", v));
watch(bundleMasterOffBehavior, (v) => applySetting("bundleMasterOffBehavior", v));

interface Defaults {
  density: Density;
  decoration: Decoration;
  indicatorStyle: IndicatorStyle;
  kindStyle: KindStyle;
  borderHighlight: boolean;
  collapsedByDefault: boolean;
  bundleCollapsedByDefault: boolean;
  collapseMode: CollapseMode;
  colorIntensity: ColorIntensity;
  focusMode: boolean;
  reduceMotion: A11yMode;
  contrast: A11yMode;
  validation: ValidationMode;
  toastLifetime: ToastLifetime;
  suppressInfoToasts: boolean;
  newModuleDisabled: boolean;
  confirmDestructiveBundle: boolean;
  bundleMasterOffBehavior: BundleMasterOffBehavior;
}

const defaults: Defaults = {
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  kindStyle: "chip",
  borderHighlight: true,
  collapsedByDefault: false,
  bundleCollapsedByDefault: false,
  collapseMode: "independent",
  colorIntensity: "standard",
  focusMode: false,
  reduceMotion: "auto",
  contrast: "auto",
  validation: "strict",
  toastLifetime: "default",
  suppressInfoToasts: false,
  newModuleDisabled: false,
  confirmDestructiveBundle: true,
  bundleMasterOffBehavior: "preserve-manual",
};

function onResetAll(): void {
  for (const [key, value] of Object.entries(defaults) as [SettingKey, unknown][]) {
    applySetting(key, value);
  }
  // Resync local refs immediately so the controls reflect the reset
  // without waiting for the next reopen.
  syncFromStore();
}

function onClose(): void {
  closePlayground();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!playgroundOpen.value) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    closePlayground();
  }
}

watch(
  playgroundOpen,
  (open) => {
    if (open) {
      // Resync local refs from the store on every open so external
      // changes (settings panel edits between modal opens, OS pref
      // changes, debug-helper writes) reflect immediately. Without
      // this, refs hold whatever they were when the modal last
      // closed and the user sees stale values.
      syncFromStore();
      window.addEventListener("keydown", onKeydown);
      // Lock body scroll while the modal is open — same pattern as
      // ModalShell uses for ModuleEditModal / ModulePickerModal.
      document.body.style.overflow = "hidden";
    } else {
      window.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = "";
    }
  },
);

onMounted(() => {
  if (playgroundOpen.value) window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="playgroundOpen"
      class="wp-pg-overlay"
      data-test="playground-overlay"
      @click.self="onClose"
    >
      <section
        class="wp-pg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wp-pg-title"
      >
        <header class="wp-pg__head">
          <div class="wp-pg__head-inner">
            <i class="pi pi-palette wp-pg__head-icon" aria-hidden="true" />
            <div>
              <h3 id="wp-pg-title" class="wp-pg__title">Display Playground</h3>
              <p class="wp-pg__subtitle">
                Tweak Wildcard Pipeline visuals — changes apply live.
              </p>
            </div>
          </div>
          <button
            class="wp-pg__close"
            type="button"
            aria-label="Close playground"
            @click="onClose"
          >
            <i class="pi pi-times" />
          </button>
        </header>

        <div class="wp-pg__body">
          <section class="wp-pg__controls" data-test="playground-controls">
            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Sizing</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Module density</span>
                <select v-model="density" class="wp-pg__select">
                  <option value="comfortable">Comfortable (default)</option>
                  <option value="compact">Compact</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Decoration</span>
                <select v-model="decoration" class="wp-pg__select">
                  <option value="full">Full (default)</option>
                  <option value="minimal">Minimal</option>
                  <option value="off">Off (flat)</option>
                </select>
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Color intensity</span>
                <select v-model="colorIntensity" class="wp-pg__select">
                  <option value="muted">Muted (low saturation)</option>
                  <option value="standard">Standard (default)</option>
                  <option value="vivid">Vivid (high saturation)</option>
                </select>
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Module identity</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Module type style</span>
                <select v-model="kindStyle" class="wp-pg__select">
                  <option value="chip">Chip (default)</option>
                  <option value="icon">Icon (compact)</option>
                  <option value="both">Both (verbose)</option>
                </select>
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">State markers</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Indicator style</span>
                <select v-model="indicatorStyle" class="wp-pg__select">
                  <option value="badge">Badge (default)</option>
                  <option value="dot">Dot (compact)</option>
                  <option value="both">Both (verbose)</option>
                </select>
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Border highlights</span>
                <WpCheck v-model="borderHighlight" aria-label="Border highlights" />
              </div>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Collapse &amp; focus</legend>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Collapse new modules by default</span>
                <WpCheck v-model="collapsedByDefault" aria-label="Collapse new modules by default" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Collapse new bundles by default</span>
                <WpCheck v-model="bundleCollapsedByDefault" aria-label="Collapse new bundles by default" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Collapse stack mode</span>
                <select v-model="collapseMode" class="wp-pg__select">
                  <option value="independent">Independent (default)</option>
                  <option value="accordion">Accordion (one at a time)</option>
                </select>
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Focus mode (dim non-hovered)</span>
                <WpCheck v-model="focusMode" aria-label="Focus mode (dim non-hovered)" />
              </div>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Accessibility</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Reduce motion</span>
                <select v-model="reduceMotion" class="wp-pg__select">
                  <option value="auto">Match system</option>
                  <option value="on">Always reduce</option>
                  <option value="off">Always allow</option>
                </select>
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Contrast</span>
                <select v-model="contrast" class="wp-pg__select">
                  <option value="auto">Match system</option>
                  <option value="on">High contrast</option>
                  <option value="off">Standard</option>
                </select>
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Runtime behavior</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Validation strictness</span>
                <select v-model="validation" class="wp-pg__select">
                  <option value="strict">Strict (default)</option>
                  <option value="relaxed">Relaxed (hide info)</option>
                  <option value="permissive">Permissive (off)</option>
                </select>
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Toast lifetime</span>
                <select v-model="toastLifetime" class="wp-pg__select">
                  <option value="short">Short (3 s)</option>
                  <option value="default">Default (5 s)</option>
                  <option value="long">Long (10 s)</option>
                  <option value="sticky">Sticky</option>
                </select>
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Suppress info toasts</span>
                <WpCheck v-model="suppressInfoToasts" aria-label="Suppress info toasts" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">New modules start disabled</span>
                <WpCheck v-model="newModuleDisabled" aria-label="New modules start disabled" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Confirm destructive bundle actions</span>
                <WpCheck v-model="confirmDestructiveBundle" aria-label="Confirm destructive bundle actions" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Bundle master OFF behavior</span>
                <select v-model="bundleMasterOffBehavior" class="wp-pg__select">
                  <option value="preserve-manual">Preserve manual (default)</option>
                  <option value="cascade-all">Cascade — clear everyone</option>
                </select>
              </label>
            </fieldset>
          </section>

          <aside class="wp-pg__preview" data-test="playground-preview">
            <PlaygroundMockup />
          </aside>
        </div>

        <footer class="wp-pg__foot">
          <button
            class="wp-pg__btn wp-pg__btn--secondary"
            type="button"
            @click="onResetAll"
          >
            Reset all to defaults
          </button>
          <button
            class="wp-pg__btn wp-pg__btn--primary"
            type="button"
            @click="onClose"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style>
/* @layer wp-extension — keeps these rules below host CSS in cascade
 * priority, so even if a host page happened to style any of the
 * .wp-pg-* selectors, the host wins. Layered author rules are
 * subservient to unlayered ones in the same origin. */
@layer wp-extension {
.wp-pg-overlay {
  position: fixed;
  inset: 0;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.55));
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  font-family: var(--wp-font-sans);
}
.wp-pg {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.5));
  width: min(960px, 100%);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
}
.wp-pg__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient);
  position: relative;
}
.wp-pg__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.wp-pg__head > * { position: relative; z-index: 1; }
.wp-pg__head-inner { display: flex; gap: 10px; align-items: flex-start; }
.wp-pg__head-icon {
  font-size: 14px;
  color: var(--wp-violet);
  margin-top: 2px;
}
.wp-pg__title {
  margin: 0;
  font: 600 13px/1.2 var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-pg__subtitle {
  margin: 4px 0 0;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-pg__close {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text2);
  border-radius: var(--wp-radius-sm);
  width: 26px;
  height: 26px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-pg__close:hover {
  border-color: var(--wp-border2);
  color: var(--wp-text);
}
.wp-pg__close .pi { font-size: 12px; }

.wp-pg__body {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.2fr);
  gap: 16px;
  padding: 16px;
  overflow: auto;
  flex: 1;
}
.wp-pg__controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.wp-pg__group {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 10px 12px 12px;
  margin: 0;
}
.wp-pg__group-title {
  font: 600 10px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-muted, var(--wp-text2));
  padding: 0 4px;
}
.wp-pg__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--wp-text);
}
.wp-pg__row + .wp-pg__row {
  border-top: 1px dashed var(--wp-border);
}
.wp-pg__row-label {
  flex: 1;
  min-width: 0;
}
.wp-pg__select {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: 12px var(--wp-font-sans);
  padding: 4px 8px;
  cursor: pointer;
  min-width: 160px;
}
.wp-pg__select:focus-visible {
  outline: 2px solid var(--wp-violet);
  outline-offset: 1px;
}
.wp-pg__preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wp-pg__foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.wp-pg__btn {
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: 600 12px var(--wp-font-sans);
  padding: 6px 14px;
  cursor: pointer;
  transition: background-color var(--wp-motion-hover), border-color var(--wp-motion-hover), color var(--wp-motion-hover);
}
.wp-pg__btn:hover {
  border-color: var(--wp-border2);
}
.wp-pg__btn--primary {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
}
.wp-pg__btn--primary:hover {
  background: var(--wp-accent2);
  border-color: var(--wp-accent2);
}

/* Narrow viewport — stack panes */
@media (max-width: 720px) {
  .wp-pg__body {
    grid-template-columns: 1fr;
  }
}
}  /* end @layer wp-extension */
</style>
