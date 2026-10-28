<script setup lang="ts">
import CloseButton from "@/components/shared/CloseButton.vue";
import { computed } from "vue";
import Button from "./ui/Button.vue";
import Toggle from "./ui/Toggle.vue";
import Icon from "./ui/Icon.vue";
import WpSegmented, { type SegmentedOption } from "@/components/shared/WpSegmented.vue";
import HsvPicker from "../../components/shared/HsvPicker.vue";
import ThemeChoices from "./settings/ThemeChoices.vue";
import {
  ACCENT_OPTIONS,
  DENSITY_OPTIONS,
  PALETTE_OPTIONS,
  SWATCH_PREVIEW,
  useTweaksStore,
  type AccentName,
  type Density,
} from "../stores/tweaksStore";
import { useUiStore } from "../stores/uiStore";

const tweaks = useTweaksStore();
const ui = useUiStore();
/** The colour theme's own accent, for the "Theme's own" swatch. */
/** "Theme's own" first, then the presets. */
const SWATCHES = ["theme", ...ACCENT_OPTIONS] as const;
const ownAccent = computed(() => PALETTE_OPTIONS.find((p) => p.id === tweaks.palette)?.swatch[ui.resolvedTheme][2]);

const sidebarCollapsed = computed<boolean>({
  get: () => ui.sidebarCollapsed,
  set: (v) => {
    if (ui.sidebarCollapsed !== v) ui.toggleSidebar();
    tweaks.setSidebarMode(v ? "collapsed" : "expanded");
  },
});

function onAccent(name: AccentName) {
  tweaks.setAccent(name);
}
const densityOptions: SegmentedOption<Density>[] = DENSITY_OPTIONS.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }));

function onDensity(d: Density) {
  tweaks.setDensity(d);
}
function onCustomHex(hex: string) {
  tweaks.setCustomHex(hex);
}
function pickCustomAccent() {
  tweaks.setAccent("custom");
}
</script>

<template>
  <aside
    class="wp-tweaks"
    :class="{ 'wp-tweaks--open': tweaks.panelOpen }"
    :inert="!tweaks.panelOpen || undefined"
    role="dialog"
    aria-label="Tweaks"
    data-test="tweaks-panel"
  >
    <header class="wp-tweaks__header">
      <h2>Tweaks</h2>
      <CloseButton
        label="Close tweaks"
        data-test="tweaks-close"
        @click="tweaks.closePanel"
      />
    </header>

    <div class="wp-tweaks__body">
      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Colours</h3>
        <ThemeChoices kind="palette" compact test-prefix="tweaks-palette" />
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Look</h3>
        <ThemeChoices kind="look" compact test-prefix="tweaks-look" />
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Accent</h3>
        <p v-if="tweaks.accentLocked" class="wp-tweaks__note">High contrast keeps its own accent.</p>
        <div v-else class="wp-tweaks__swatches" role="radiogroup" aria-label="Accent palette">
          <button
            v-for="name in SWATCHES"
            :key="name"
            type="button"
            role="radio"
            :aria-checked="tweaks.accent === name"
            class="wp-tweaks__swatch"
            :class="{ 'is-active': tweaks.accent === name, 'wp-tweaks__swatch--theme': name === 'theme' }"
            :style="name === 'theme' ? { '--own-accent': ownAccent } : { background: SWATCH_PREVIEW[name] }"
            :aria-label="name === 'theme' ? 'Accent: the colour theme\'s own' : `Accent: ${name}`"
            :title="name === 'theme' ? 'Theme\'s own' : name"
            :data-test="`tweaks-accent-${name}`"
            @click="onAccent(name)"
          />
          <button
            type="button"
            role="radio"
            :aria-checked="tweaks.accent === 'custom'"
            class="wp-tweaks__swatch wp-tweaks__swatch--custom"
            :class="{ 'is-active': tweaks.accent === 'custom' }"
            :style="{ background: tweaks.customHex }"
            aria-label="Accent: custom"
            title="Custom"
            data-test="tweaks-accent-custom"
            @click="pickCustomAccent"
          >
            <Icon name="pi-palette" />
          </button>
        </div>
        <div v-if="tweaks.accent === 'custom' && !tweaks.accentLocked" class="wp-tweaks__custom-picker">
          <HsvPicker
            :model-value="tweaks.customHex"
            aria-label="Custom accent color"
            @update:model-value="onCustomHex"
          />
        </div>
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Density</h3>
        <WpSegmented
          :model-value="tweaks.density"
          :options="densityOptions"
          size="sm"
          block
          aria-label="Density"
          test-prefix="tweaks-density"
          @update:model-value="onDensity"
        />
      </section>

      <section class="wp-tweaks__section">
        <h3 class="wp-tweaks__section-title">Sidebar</h3>
        <Toggle
          v-model="sidebarCollapsed"
          label="Collapse to icons"
          aria-label="Collapse sidebar to icons"
          data-test="tweaks-sidebar-toggle"
        />
      </section>

      <footer class="wp-tweaks__footer">
        <Button
          variant="ghost"
          icon="pi-refresh"
          data-test="tweaks-reset"
          @click="tweaks.reset"
        >
          Reset to defaults
        </Button>
      </footer>
    </div>
  </aside>

  <div
    v-if="tweaks.panelOpen"
    class="wp-tweaks__backdrop"
    data-test="tweaks-backdrop"
    @click="tweaks.closePanel"
  />
</template>

<style scoped>
/* Slide-in panel anchored to the right edge of the viewport. The shell mirrors
   the prototype's floating glass card but lives full-height for predictable
   focus management; nothing in tokens.css owns these classes. */
.wp-tweaks {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 90vw;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border);
  box-shadow: var(--wp-shadow-lg);
  transform: translateX(100%);
  transition: transform 220ms cubic-bezier(0.3, 0.7, 0.4, 1);
  pointer-events: none;
}
.wp-tweaks--open {
  transform: translateX(0);
  pointer-events: auto;
}

.wp-tweaks__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--wp-space-6) var(--wp-space-6);
  border-bottom: 1px solid var(--wp-border);
}
.wp-tweaks__header h2 {
  margin: 0;
  font-size: var(--wp-text-md);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--wp-text);
}

.wp-tweaks__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--wp-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}

.wp-tweaks__section { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-tweaks__section-title {
  margin: 0;
  font-size: 10px; /* audit-exempt: micro uppercase section header — below scale floor */
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}

.wp-tweaks__swatches { display: flex; gap: var(--wp-space-4); flex-wrap: wrap; }
.wp-tweaks__swatch {
  appearance: none;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid var(--wp-border);
  cursor: pointer;
  padding: 0;
  transition: border-color 120ms ease, transform 120ms ease;
}
.wp-tweaks__swatch:hover { transform: scale(1.05); }
.wp-tweaks__swatch.is-active {
  border-color: var(--wp-text);
  box-shadow: 0 0 0 2px var(--wp-bg-1), 0 0 0 4px var(--wp-accent-500);
}
.wp-tweaks__swatch--theme {
  background: linear-gradient(135deg, var(--own-accent) 50%, var(--wp-bg-3) 50%);
}
.wp-tweaks__note { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-tweaks__swatch--custom {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}
.wp-tweaks__custom-picker {
  margin-top: var(--wp-space-4);
}


.wp-tweaks__footer { margin-top: auto; padding-top: var(--wp-space-5); border-top: 1px solid var(--wp-border); }

.wp-tweaks__backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.32));
  /* Backdrop only renders when panel is open; no transition needed. */
}
</style>
