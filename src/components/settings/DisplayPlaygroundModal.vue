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
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import {
  playgroundOpen,
  closePlayground,
  applySetting,
  getSettingValue,
  type DisplayKey,
} from "./playground-store";
import PlaygroundMockup from "./PlaygroundMockup.vue";

type Density = "comfortable" | "compact" | "minimal";
type Decoration = "full" | "minimal" | "off";
type IndicatorStyle = "both" | "badge" | "dot";
type KindStyle = "both" | "icon" | "chip";

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// Reactive view of current setting values — re-read whenever the modal
// opens so we pick up the latest from extensionManager. Computed so
// flipping a control via applySetting → onChange → re-read keeps the
// select binding in sync without manual state plumbing.
const density = computed<Density>({
  get: () => asString(getSettingValue("density"), "comfortable") as Density,
  set: (v) => applySetting("density", v),
});
const decoration = computed<Decoration>({
  get: () => asString(getSettingValue("decoration"), "full") as Decoration,
  set: (v) => applySetting("decoration", v),
});
const indicatorStyle = computed<IndicatorStyle>({
  get: () => asString(getSettingValue("indicatorStyle"), "badge") as IndicatorStyle,
  set: (v) => applySetting("indicatorStyle", v),
});
const kindStyle = computed<KindStyle>({
  get: () => asString(getSettingValue("kindStyle"), "chip") as KindStyle,
  set: (v) => applySetting("kindStyle", v),
});
const borderHighlight = computed<boolean>({
  get: () => asBool(getSettingValue("borderHighlight"), true),
  set: (v) => applySetting("borderHighlight", v),
});
const collapsedByDefault = computed<boolean>({
  get: () => asBool(getSettingValue("collapsedByDefault"), false),
  set: (v) => applySetting("collapsedByDefault", v),
});
const focusMode = computed<boolean>({
  get: () => asBool(getSettingValue("focusMode"), false),
  set: (v) => applySetting("focusMode", v),
});

interface Defaults {
  density: Density;
  decoration: Decoration;
  indicatorStyle: IndicatorStyle;
  kindStyle: KindStyle;
  borderHighlight: boolean;
  collapsedByDefault: boolean;
  focusMode: boolean;
}

const defaults: Defaults = {
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  kindStyle: "chip",
  borderHighlight: true,
  collapsedByDefault: false,
  focusMode: false,
};

function onResetAll(): void {
  for (const [key, value] of Object.entries(defaults) as [DisplayKey, unknown][]) {
    applySetting(key, value);
  }
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
              <label class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Border highlights</span>
                <input
                  type="checkbox"
                  class="wp-pg__check"
                  :checked="borderHighlight"
                  @change="borderHighlight = ($event.target as HTMLInputElement).checked"
                />
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Behavior</legend>
              <label class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Collapse new modules by default</span>
                <input
                  type="checkbox"
                  class="wp-pg__check"
                  :checked="collapsedByDefault"
                  @change="collapsedByDefault = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Focus mode (dim non-hovered)</span>
                <input
                  type="checkbox"
                  class="wp-pg__check"
                  :checked="focusMode"
                  @change="focusMode = ($event.target as HTMLInputElement).checked"
                />
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
.wp-pg__check {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--wp-accent);
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
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
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
</style>
