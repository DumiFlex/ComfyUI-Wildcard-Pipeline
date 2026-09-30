<script setup lang="ts">
import { RouterLink } from "vue-router";
import Select from "../../ui/Select.vue";
import Icon from "../../ui/Icon.vue";
import type { SelectOption } from "../../ui/select-types";
import HsvPicker from "../../../../components/shared/HsvPicker.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import SegControl, { type SegOption } from "../SegControl.vue";
import { useUiStore, type DensityMode, type MotionMode, type StartPage, type ThemeMode } from "../../../stores/uiStore";
import { ACCENT_OPTIONS, SWATCH_PREVIEW, useTweaksStore } from "../../../stores/tweaksStore";

const ui = useUiStore();
const tweaks = useTweaksStore();

const THEMES: SegOption<ThemeMode>[] = [
  { value: "dark", label: "Dark", icon: "pi-moon" },
  { value: "light", label: "Light", icon: "pi-sun" },
  { value: "auto", label: "Auto", icon: "pi-desktop" },
];
const DENSITIES: SegOption<DensityMode>[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "cozy", label: "Cozy" },
];
type SidebarChoice = "expanded" | "collapsed";
const SIDEBAR: SegOption<SidebarChoice>[] = [
  { value: "expanded", label: "Labels" },
  { value: "collapsed", label: "Icons only" },
];
const MOTION: SegOption<MotionMode>[] = [
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
  <SettingGroup title="Look">
    <SettingRow label="Theme" hint="Dark, light, or follow the system." setting-key="theme">
      <SegControl
        :model-value="ui.themeMode"
        :options="THEMES"
        aria-label="Theme"
        test-prefix="settings-theme"
        @update:model-value="(v) => ui.setThemeMode(v as ThemeMode)"
      />
    </SettingRow>
    <SettingRow
      label="Accent color"
      hint="The highlight color for buttons, links and selection. Pick a preset or your own."
      setting-key="accent"
      :stacked="tweaks.accent === 'custom'"
    >
      <div class="wp-set-swatches" role="radiogroup" aria-label="Accent color">
        <button
          v-for="name in ACCENT_OPTIONS"
          :key="name"
          type="button"
          role="radio"
          class="wp-set-swatch"
          :aria-checked="tweaks.accent === name"
          :aria-label="`Accent: ${name}`"
          :title="name"
          :style="{ background: SWATCH_PREVIEW[name] }"
          :data-test="`settings-accent-${name}`"
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
          @click="tweaks.setAccent('custom')"
        ><Icon name="pi-palette" /></button>
      </div>
      <div v-if="tweaks.accent === 'custom'" class="wp-set-picker">
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
      <SegControl
        :model-value="ui.density"
        :options="DENSITIES"
        aria-label="Density"
        test-prefix="settings-density"
        @update:model-value="(v) => ui.setDensity(v as DensityMode)"
      />
    </SettingRow>
    <SettingRow label="Reduce motion" hint="Turn animations and transitions off in the manager." setting-key="motion">
      <SegControl
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
      <SegControl
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
.wp-set-picker { width: 100%; max-width: 360px; }
.wp-set-link { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
</style>
