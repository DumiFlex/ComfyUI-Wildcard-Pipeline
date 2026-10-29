<script setup lang="ts">
import { computed } from "vue";
import Button from "./ui/Button.vue";
import Drawer from "./ui/Drawer.vue";
import Toggle from "./ui/Toggle.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import HsvPicker from "../../kit/HsvPicker.vue";
import ThemeChoices from "./settings/ThemeChoices.vue";
import {
  ACCENT_LABELS,
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
/** "Theme's own" first, then the presets, then Custom. */
const SWATCHES: AccentName[] = ["theme", ...ACCENT_OPTIONS, "custom"];
/** The colour theme's own accent, for the "Theme's own" swatch. */
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
/** The presets round a colour wheel, for Custom before a colour is picked. */
const WHEEL = `conic-gradient(${[...ACCENT_OPTIONS, ACCENT_OPTIONS[0]].map((n) => SWATCH_PREVIEW[n]).join(", ")}) border-box`;
/** Theme's own: half its accent; Custom: the picked colour once chosen
 *  (a colour wheel until then); presets: their 500 stop. */
function swatchStyle(name: AccentName): Record<string, string | undefined> {
  if (name === "theme") return { "--own-accent": ownAccent.value };
  if (name === "custom") return { background: tweaks.accent === "custom" ? tweaks.customHex : WHEEL };
  return { background: SWATCH_PREVIEW[name] };
}
const densityOptions: SegmentedOption<Density>[] = DENSITY_OPTIONS.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }));

function onDensity(d: Density) {
  tweaks.setDensity(d);
}
function onCustomHex(hex: string) {
  tweaks.setCustomHex(hex);
}
</script>

<template>
  <Drawer
    :open="tweaks.panelOpen"
    title="Tweaks"
    width="320px"
    @update:open="(v) => { if (!v) tweaks.closePanel(); }"
  >
    <div class="wp-tweaks" data-test="tweaks-panel">
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
            class="wp-tweaks__accent"
            :class="{ 'is-active': tweaks.accent === name }"
            :data-test="`tweaks-accent-${name}`"
            @click="onAccent(name)"
          >
            <span
              class="wp-tweaks__swatch"
              :class="{ 'wp-tweaks__swatch--theme': name === 'theme' }"
              :style="swatchStyle(name)"
              aria-hidden="true"
            />
            <span class="wp-tweaks__accent-name">{{ ACCENT_LABELS[name] }}</span>
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

    </div>
    <template #footer>
      <Button
        variant="ghost"
        icon="pi-refresh"
        data-test="tweaks-reset"
        @click="tweaks.reset"
      >
        Reset to defaults
      </Button>
    </template>
  </Drawer>
</template>

<style scoped>
.wp-tweaks {
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

/* Each accent is a swatch with its name under it, four to a row. */
.wp-tweaks__swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--wp-space-4) var(--wp-space-2); }
.wp-tweaks__accent {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--wp-text-muted);
  font: inherit;
  font-size: var(--wp-text-xs);
  cursor: pointer;
}
.wp-tweaks__accent:hover,
.wp-tweaks__accent.is-active { color: var(--wp-text); }
.wp-tweaks__accent:focus-visible { outline: none; }
.wp-tweaks__accent:focus-visible .wp-tweaks__swatch { box-shadow: var(--wp-focus-ring); }
.wp-tweaks__accent-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tweaks__swatch {
  width: 28px;
  height: 28px;
  border-radius: var(--wp-radius-cap, 999px);
  border: 2px solid var(--wp-border);
  transition: border-color 120ms ease, transform 120ms ease;
}
.wp-tweaks__accent:hover .wp-tweaks__swatch { transform: scale(1.05); }
.wp-tweaks__accent.is-active .wp-tweaks__swatch {
  border-color: var(--wp-text);
  box-shadow: 0 0 0 2px var(--wp-bg-1), 0 0 0 4px var(--wp-accent-500);
}
/* `border-box`: see AppearanceSection's .wp-set-swatch--theme. */
.wp-tweaks__swatch--theme {
  background: linear-gradient(135deg, var(--own-accent) 50%, var(--wp-bg-3) 50%) border-box;
}
.wp-tweaks__note { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-tweaks__custom-picker {
  margin-top: var(--wp-space-4);
}
</style>
