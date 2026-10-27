<script setup lang="ts">
import { ref } from "vue";

const tab = ref("options");
const TABS = [
  { id: "options", label: "Options" },
  { id: "rules", label: "Rules" },
  { id: "preview", label: "Preview" },
];
</script>

<template>
  <div class="wp-kit__stack">
    <div class="wp-tabs" role="tablist" aria-label="Editor sections">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        class="wp-tab"
        role="tab"
        :aria-selected="tab === t.id"
        :data-active="tab === t.id"
        @click="tab = t.id"
      >{{ t.label }}</button>
    </div>
  </div>
</template>
