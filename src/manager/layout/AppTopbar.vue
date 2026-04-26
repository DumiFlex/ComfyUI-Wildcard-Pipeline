<script setup lang="ts">
import Button from "primevue/button";
import { useRouter } from "vue-router";
import { useUiStore } from "../stores/uiStore";

const ui = useUiStore();
const router = useRouter();
const version = "1.4.0-dev";
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;
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
        icon="pi pi-cog" text rounded severity="secondary"
        aria-label="Settings"
        @click="router.push('/settings')"
      />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: 56px;
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
.brand:hover { color: #fff; }
.brand-logo { width: 24px; height: 24px; }
.brand-name { letter-spacing: 0.2px; }
.brand-version { font-size: 11px; color: var(--wp-text3); font-weight: 400; }
</style>
