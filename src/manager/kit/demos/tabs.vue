<script setup lang="ts">
import { ref } from "vue";
import WpTabs from "@/components/shared/WpTabs.vue";
import "@/components/shared/theme.css";

const tab = ref("options");
const TABS = [
  { id: "options", label: "Options", icon: "pi-list", count: 12 },
  { id: "rules", label: "Rules", count: 3 },
  { id: "preview", label: "Preview" },
  { id: "history", label: "History", disabled: true },
];
const canvasTab = ref("vars");
const CANVAS_TABS = [
  { id: "vars", label: "Variables" },
  { id: "trace", label: "Trace" },
  { id: "raw", label: "Raw" },
];
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <WpTabs v-model="tab" :tabs="TABS" aria-label="Editor sections">
      <template #panel="{ id }">
        <p class="wp-kit__muted wp-kit__tab-panel">The {{ id }} panel. Focus a tab and use the arrow keys, Home and End.</p>
      </template>
    </WpTabs>
    <div class="wp-kit__canvas wp-canvas-scope">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <WpTabs v-model="canvasTab" :tabs="CANVAS_TABS" size="sm" aria-label="Debug view" />
    </div>
  </div>
</template>
