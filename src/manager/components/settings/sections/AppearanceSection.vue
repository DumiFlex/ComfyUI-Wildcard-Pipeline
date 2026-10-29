<script setup lang="ts">
import { RouterLink } from "vue-router";
import Select from "../../../../kit/Select.vue";
import Icon from "../../../../kit/Icon.vue";
import type { SelectOption } from "../../../../kit/select-types";
import HsvPicker from "../../../../kit/HsvPicker.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import ThemeChoices from "../ThemeChoices.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import { useUiStore, type DensityMode, type MotionMode, type StartPage, type ThemeMode } from "../../../stores/uiStore";
import { computed } from "vue";
import { ACCENT_LABELS, ACCENT_OPTIONS, PALETTE_OPTIONS, SWATCH_PREVIEW, useTweaksStore, type AccentName } from "../../../stores/tweaksStore";

const ui = useUiStore();
const tweaks = useTweaksStore();
/** "Theme's own" first, then the presets, then Custom. */
const SWATCHES: AccentName[] = ["theme", ...ACCENT_OPTIONS, "custom"];
/** The colour theme's own accent, for the "Theme's own" swatch. */
const ownAccent = computed(() => PALETTE_OPTIONS.find((p) => p.id === tweaks.palette)?.swatch[ui.resolvedTheme][2]);

/** Theme's own: half its accent; Custom: the picked colour once chosen
 *  (the colour wheel until then); presets: their 500 stop. */
function swatchStyle(name: AccentName): Record<string, string | undefined> {
  if (name === "theme") return { "--own-accent": ownAccent.value };
  if (name === "custom") return tweaks.accent === "custom" ? { background: tweaks.customHex } : {};
  return { background: SWATCH_PREVIEW[name] };
}

const THEMES: SegmentedOption<ThemeMode>[] = [
  { value: "dark", label: "Dark", icon: "pi-moon" },
  { value: "light", label: "Light", icon: "pi-sun" },
  { value: "auto", label: "Auto", icon: "pi-desktop" },
];
const DENSITIES: SegmentedOption<DensityMode>[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "cozy", label: "Cozy" },
];
type SidebarChoice = "expanded" | "collapsed";
const SIDEBAR: SegmentedOption<SidebarChoice>[] = [
  { value: "expanded", label: "Labels" },
  { value: "collapsed", label: "Icons only" },
];
const MOTION: SegmentedOption<MotionMode>[] = [
  { value: "auto", label: "Match system" },
  { value: "reduce", label: "Always reduce" },
];
const START_PAGES: SelectOption[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "last", label: "Last page I was on" },
  { value: "all", label: "All items" },
  { value: "wildcards", label: "Wildcards" },
  { value: "test", label: "Test Runner" },
];

function setSidebar(v: SidebarChoice): void {
  ui.setSidebarCollapsed(v === "collapsed");
  tweaks.setSidebarMode(v);
}
</script>

<template>
  <SettingGroup title="Theme">
    <SettingRow
      label="Colours"
      hint="The colour theme for the manager: surfaces, text and its own accent. Module kind colours stay the same in every theme."
      setting-key="colours"
      stacked
    >
      <ThemeChoices kind="palette" />
    </SettingRow>
    <SettingRow
      label="Look"
      hint="Everything that is not colour: corners, type, borders and how a selected item is drawn. Works with any colour theme."
      setting-key="look"
      stacked
    >
      <ThemeChoices kind="look" />
    </SettingRow>
    <SettingRow label="Mode" hint="Dark, light, or follow the system." setting-key="theme">
      <WpSegmented
        :model-value="ui.themeMode"
        :options="THEMES"
        aria-label="Theme"
        test-prefix="settings-theme"
        @update:model-value="(v) => ui.setThemeMode(v as ThemeMode)"
      />
    </SettingRow>
    <SettingRow
      label="Accent color"
      :hint="tweaks.accentLocked
        ? 'High contrast keeps its own accent, so this is off while it is the colour theme.'
        : 'The highlight color for buttons, links and selection. Keep the colour theme\'s own, pick a preset, or your own.'"
      setting-key="accent"
      :stacked="tweaks.accent === 'custom' && !tweaks.accentLocked"
    >
      <div
        class="wp-set-swatches"
        role="radiogroup"
        aria-label="Accent color"
        :aria-disabled="tweaks.accentLocked || undefined"
        :class="{ 'is-locked': tweaks.accentLocked }"
      >
        <button
          v-for="name in SWATCHES"
          :key="name"
          type="button"
          role="radio"
          class="wp-set-accent"
          :aria-checked="name === 'theme' ? tweaks.accent === 'theme' || tweaks.accentLocked : tweaks.accent === name"
          :data-test="`settings-accent-${name}`"
          :disabled="tweaks.accentLocked"
          @click="tweaks.setAccent(name)"
        >
          <span
            class="wp-set-swatch"
            :class="{ 'wp-set-swatch--theme': name === 'theme', 'wp-set-swatch--custom': name === 'custom' }"
            :style="swatchStyle(name)"
            aria-hidden="true"
          />
          <span class="wp-set-accent__name">{{ ACCENT_LABELS[name] }}</span>
        </button>
      </div>
      <div v-if="tweaks.accent === 'custom' && !tweaks.accentLocked" class="wp-set-picker">
        <HsvPicker
          :model-value="tweaks.customHex"
          aria-label="Custom accent color"
          @update:model-value="tweaks.setCustomHex($event)"
        />
      </div>
    </SettingRow>
    <SettingRow
      label="Density"
      hint="Spacing and control height across the manager. The canvas nodes have their own density under Canvas."
      setting-key="density"
    >
      <WpSegmented
        :model-value="ui.density"
        :options="DENSITIES"
        aria-label="Density"
        test-prefix="settings-density"
        @update:model-value="(v) => ui.setDensity(v as DensityMode)"
      />
    </SettingRow>
    <SettingRow label="Reduce motion" hint="Turn animations and transitions off in the manager." setting-key="motion">
      <WpSegmented
        :model-value="ui.motion"
        :options="MOTION"
        aria-label="Reduce motion"
        test-prefix="settings-motion"
        @update:model-value="(v) => ui.setMotion(v as MotionMode)"
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Layout">
    <SettingRow label="Sidebar" hint="Show the navigation with labels, or as icons only." setting-key="sidebar">
      <WpSegmented
        :model-value="ui.sidebarCollapsed ? 'collapsed' : 'expanded'"
        :options="SIDEBAR"
        aria-label="Sidebar"
        test-prefix="settings-sidebar"
        @update:model-value="(v) => setSidebar(v as SidebarChoice)"
      />
    </SettingRow>
    <SettingRow label="Start page" hint="What the manager opens to." setting-key="start-page">
      <Select
        :model-value="ui.startPage"
        :options="START_PAGES"
        :filterable="false"
        aria-label="Start page"
        data-test="settings-start-page"
        @update:model-value="(v) => ui.setStartPage(v as StartPage)"
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Canvas nodes">
    <SettingRow
      label="Module density, decoration, colors"
      hint="These style the nodes on the ComfyUI canvas rather than this page."
    >
      <RouterLink class="wp-btn wp-btn--secondary wp-set-link" :to="{ name: 'settings', params: { section: 'canvas' } }">
        Open Canvas settings <Icon name="pi-arrow-right" />
      </RouterLink>
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-swatches { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: flex-start; }
/* Each accent: its swatch with the name under it. */
.wp-set-accent {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--wp-text-muted);
  font: inherit;
  font-size: var(--wp-text-xs);
  cursor: pointer;
}
.wp-set-accent:hover,
.wp-set-accent[aria-checked="true"] { color: var(--wp-text); }
.wp-set-accent:focus-visible { outline: none; }
.wp-set-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%; /* round: colour swatch */
  border: 2px solid transparent;
}
.wp-set-accent[aria-checked="true"] .wp-set-swatch { outline: 2px solid var(--wp-text); outline-offset: 2px; }
.wp-set-accent:focus-visible .wp-set-swatch { outline: 2px solid var(--wp-accent-500); outline-offset: 2px; }
.wp-set-swatch--custom {
  background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #14b8a6, #6366f1, #a855f7, #f43f5e) border-box;
}
/* "Theme's own": half the live accent, half the page, so it reads as
 * "whatever the colour theme brings". `border-box` sizes the gradient to the
 * whole circle: sized to the padding box it tiles again under the 2px
 * border, and the tile corners showed as a square inside the circle. */
.wp-set-swatch--theme {
  background: linear-gradient(135deg, var(--own-accent) 50%, var(--wp-bg-3) 50%) border-box;
  border-color: var(--wp-border-strong);
}
.wp-set-swatches.is-locked .wp-set-accent:not([data-test="settings-accent-theme"]) { opacity: 0.35; }
.wp-set-accent:disabled { cursor: not-allowed; }
.wp-set-picker { width: 100%; max-width: 360px; }
.wp-set-link { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
</style>
