<script setup lang="ts">
import { RouterLink } from "vue-router";
import Select from "../../ui/Select.vue";
import Icon from "../../ui/Icon.vue";
import type { SelectOption } from "../../ui/select-types";
import HsvPicker from "../../../../components/shared/HsvPicker.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import ThemeChoices from "../ThemeChoices.vue";
import WpSegmented, { type SegmentedOption } from "@/components/shared/WpSegmented.vue";
import { useUiStore, type DensityMode, type MotionMode, type StartPage, type ThemeMode } from "../../../stores/uiStore";
import { computed } from "vue";
import { ACCENT_OPTIONS, PALETTE_OPTIONS, SWATCH_PREVIEW, useTweaksStore } from "../../../stores/tweaksStore";

const ui = useUiStore();
const tweaks = useTweaksStore();
/** The colour theme's own accent, for the "Theme's own" swatch. */
/** "Theme's own" first, then the presets. */
const SWATCHES = ["theme", ...ACCENT_OPTIONS] as const;
const ownAccent = computed(() => PALETTE_OPTIONS.find((p) => p.id === tweaks.palette)?.swatch[ui.resolvedTheme][2]);

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
          class="wp-set-swatch"
          :class="{ 'wp-set-swatch--theme': name === 'theme' }"
          :aria-checked="name === 'theme' ? tweaks.accent === 'theme' || tweaks.accentLocked : tweaks.accent === name"
          :aria-label="name === 'theme' ? 'Accent: the colour theme\'s own' : `Accent: ${name}`"
          :title="name === 'theme' ? 'Theme\'s own' : name"
          :style="name === 'theme' ? { '--own-accent': ownAccent } : { background: SWATCH_PREVIEW[name] }"
          :data-test="`settings-accent-${name}`"
          :disabled="tweaks.accentLocked"
          @click="tweaks.setAccent(name)"
        />
        <button
          type="button"
          role="radio"
          class="wp-set-swatch wp-set-swatch--custom"
          :aria-checked="tweaks.accent === 'custom'"
          aria-label="Accent: custom"
          title="Custom"
          :style="tweaks.accent === 'custom' ? { background: tweaks.customHex } : undefined"
          data-test="settings-accent-custom"
          :disabled="tweaks.accentLocked"
          @click="tweaks.setAccent('custom')"
        ><Icon name="pi-palette" /></button>
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
.wp-set-swatches { display: flex; gap: 10px; align-items: center; }
.wp-set-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.wp-set-swatch[aria-checked="true"] { outline: 2px solid var(--wp-text); outline-offset: 2px; }
.wp-set-swatch:focus-visible { outline: 2px solid var(--wp-accent-500); outline-offset: 2px; }
.wp-set-swatch--custom {
  background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #14b8a6, #6366f1, #a855f7, #f43f5e);
  color: #fff;
  font-size: 11px;
}
/* "Theme's own": half the live accent, half the page, so it reads as
 * "whatever the colour theme brings". */
.wp-set-swatch--theme {
  background: linear-gradient(135deg, var(--own-accent) 50%, var(--wp-bg-3) 50%);
  border-color: var(--wp-border-strong);
}
.wp-set-swatches.is-locked .wp-set-swatch:not(.wp-set-swatch--theme) { opacity: 0.35; cursor: not-allowed; }
.wp-set-swatch:disabled { cursor: not-allowed; }
.wp-set-picker { width: 100%; max-width: 360px; }
.wp-set-link { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
</style>
