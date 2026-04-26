<script setup lang="ts">
import Button from "primevue/button";
import { useUiStore } from "../stores/uiStore";

const ui = useUiStore();
</script>

<template>
  <header class="h-12 px-4 flex items-center justify-between bg-wp-bg border-b border-wp-border sticky top-0 z-10">
    <div class="flex items-center gap-3">
      <Button
        icon="pi pi-bars"
        text
        rounded
        severity="secondary"
        aria-label="Toggle menu"
        @click="ui.toggleSidebar"
      />
      <div class="flex items-center gap-2 font-semibold">
        <div
          class="w-5 h-5 rounded"
          style="background: var(--wp-brand-gradient)"
          aria-hidden="true"
        />
        <span>Wildcard Pipeline</span>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <Button
        icon="pi pi-moon"
        text
        rounded
        severity="secondary"
        aria-label="Toggle theme"
        @click="ui.toggleTheme"
      />
    </div>
  </header>
</template>
