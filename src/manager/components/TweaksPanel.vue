<script setup lang="ts">
import { computed } from "vue";
import Button from "@/kit/Button.vue";
import Drawer from "@/kit/Drawer.vue";
import WpSwitch from "@/kit/WpSwitch.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import HsvPicker from "@/kit/HsvPicker.vue";
import RadioGroup from "@/kit/RadioGroup.vue";
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
        <RadioGroup
          v-else
          class="wp-tweaks__swatches"
          :model-value="tweaks.accent"
          :options="SWATCHES.map((name) => ({ value: name, label: ACCENT_LABELS[name] }))"
          variant="swatch"
          named
          aria-label="Accent palette"
          test-prefix="tweaks-accent"
          @update:model-value="onAccent"
        >
          <template #swatch="{ option }">
            <span
              class="wp-tweaks__swatch"
              :class="{ 'wp-tweaks__swatch--theme': option.value === 'theme' }"
              :style="swatchStyle(option.value)"
            />
          </template>
        </RadioGroup>
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
        <WpSwitch
          v-model="sidebarCollapsed"
          size="md"
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

/* The kit's named swatches, four to a row; the slot paints each one. */
.wp-tweaks__swatches.wp-radio-group { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--wp-space-2); }
.wp-tweaks__swatch { display: block; width: 100%; height: 100%; }
.wp-tweaks__swatches :deep(.wp-radio-group__name) { white-space: nowrap; }
.wp-tweaks__swatch--theme { background: linear-gradient(135deg, var(--own-accent) 50%, var(--wp-bg-3) 50%); }
.wp-tweaks__note { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-tweaks__custom-picker {
  margin-top: var(--wp-space-4);
}
</style>
