<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import { useRouter } from "vue-router";
import { useUiStore } from "../stores/uiStore";

const ui = useUiStore();
const router = useRouter();
const version = "1.4.0-dev";
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

/** Icon for the theme button reflects the *next* state in the cycle. */
const themeIcon = computed(() => {
  switch (ui.themeMode) {
    case "dark":  return "pi pi-sun";        // next: light
    case "light": return "pi pi-desktop";    // next: auto
    default:      return "pi pi-moon";       // next: dark
  }
});
const themeLabel = computed(() =>
  ui.themeMode === "dark"  ? "Switch to light theme" :
  ui.themeMode === "light" ? "Switch to auto (system) theme" :
                             "Switch to dark theme",
);
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <Button
        icon="pi pi-bars" text rounded severity="secondary"
        aria-label="Toggle menu"
        @click="ui.toggleSidebar"
      />
      <RouterLink to="/" class="brand">
        <img :src="logoSrc" alt="" class="brand-logo" />
        <span class="brand-name">Wildcard Pipeline</span>
        <span class="brand-version">v{{ version }}</span>
      </RouterLink>
    </div>
    <div class="topbar-right">
      <Button
        :icon="themeIcon" text rounded severity="secondary"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="ui.cycleTheme"
      />
      <Button
        icon="pi pi-cog" text rounded severity="secondary"
        aria-label="Settings"
        @click="router.push('/settings')"
      />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--wp-topbar-h, 56px);
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 8px; }
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--wp-text);
  font-weight: 600;
}
.brand:hover { color: var(--wp-text); filter: brightness(1.1); }
.brand-logo { width: 24px; height: 24px; }
.brand-name { letter-spacing: 0.2px; }
.brand-version {
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3));
  font-weight: 400;
}
</style>
