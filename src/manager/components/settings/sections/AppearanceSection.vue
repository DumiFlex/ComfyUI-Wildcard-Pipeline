<script setup lang="ts">
import { RouterLink } from "vue-router";
import Select from "@/kit/Select.vue";
import Icon from "@/kit/Icon.vue";
import type { SelectOption } from "@/kit/select-types";
import HsvPicker from "@/kit/HsvPicker.vue";
import RadioGroup from "@/kit/RadioGroup.vue";
import SettingGroup from "@/kit/SettingGroup.vue";
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
      <RadioGroup
        class="wp-set-swatches"
        :class="{ 'is-locked': tweaks.accentLocked }"
        :model-value="tweaks.accentLocked ? 'theme' : tweaks.accent"
        :options="SWATCHES.map((name) => ({ value: name, label: ACCENT_LABELS[name] }))"
        variant="swatch"
        named
        :disabled="tweaks.accentLocked"
        aria-label="Accent color"
        test-prefix="settings-accent"
        @update:model-value="(name) => tweaks.setAccent(name)"
      >
        <template #swatch="{ option }">
          <span
            class="wp-set-swatch"
            :class="{ 'wp-set-swatch--theme': option.value === 'theme', 'wp-set-swatch--custom': option.value === 'custom' }"
            :style="swatchStyle(option.value)"
          />
        </template>
      </RadioGroup>
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
/* The kit's named swatches; the slot paints each one (a plain colour, the
 * split "Theme's own", the rainbow "Custom"). */
.wp-set-swatch { display: block; width: 100%; height: 100%; }
.wp-set-swatches :deep(.wp-radio-group__swatch) { width: 24px; height: 24px; }
.wp-set-swatch--custom {
  background: conic-gradient(hsl(350 89% 60%), hsl(38 92% 50%), hsl(142 71% 45%), hsl(173 80% 40%), hsl(239 84% 67%), hsl(271 91% 65%), hsl(350 89% 60%));
}
/* "Theme's own": half the live accent, half the page, so it reads as
 * "whatever the colour theme brings". */
.wp-set-swatch--theme { background: linear-gradient(135deg, var(--own-accent) calc(50% - 0.75px), var(--wp-bg-3) calc(50% + 0.75px)); }
/* Locked (High contrast): the theme's own stays readable, the rest fade. */
.wp-set-swatches.is-locked :deep([data-test="settings-accent-theme"]) { opacity: 1; }
.wp-set-picker { width: 100%; max-width: 360px; }
.wp-set-link { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
</style>
