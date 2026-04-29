<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import { useUiStore } from "../stores/uiStore";
import { useTweaksStore } from "../stores/tweaksStore";

const ui = useUiStore();
const router = useRouter();
const tweaks = useTweaksStore();

const version = "1.4.0-dev";
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

/** Theme button icon — mirrors prototype (current state, not next). */
const themeIcon = computed(() => {
  switch (ui.themeMode) {
    case "light": return "pi-sun";
    case "dark":  return "pi-moon";
    default:      return "pi-desktop";
  }
});
const themeLabel = computed(() => `Theme: ${ui.themeMode}`);
</script>

<template>
  <header class="wp-topbar">
    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Toggle sidebar"
      data-test="topbar-toggle"
      @click="ui.toggleSidebar"
    >
      <Icon name="pi-bars" />
    </button>

    <RouterLink to="/" class="wp-topbar__brand" data-test="topbar-brand">
      <img :src="logoSrc" alt="" />
      <span>Wildcard Pipeline</span>
      <span class="wp-topbar__version">v{{ version }}</span>
    </RouterLink>

    <div class="wp-topbar__spacer" />

    <button
      type="button"
      class="wp-topbar__icon-btn"
      :aria-label="themeLabel"
      :title="themeLabel"
      data-test="topbar-theme"
      @click="ui.cycleTheme"
    >
      <Icon :name="themeIcon" />
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Tweaks"
      title="Tweaks"
      data-test="topbar-tweaks"
      @click="tweaks.togglePanel"
    >
      <Icon name="pi-sliders-h" />
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Settings"
      title="Settings"
      data-test="topbar-settings"
      @click="router.push('/settings')"
    >
      <Icon name="pi-cog" />
    </button>
  </header>
</template>

<style scoped>
/* Layout primitives — .wp-topbar, .wp-topbar__brand, .wp-topbar__version,
   .wp-topbar__spacer, .wp-topbar__icon-btn — are all defined globally in
   tokens.css. Community status pill + user menu styles moved to the
   feat/community-tab branch alongside the views that use them. */
</style>
