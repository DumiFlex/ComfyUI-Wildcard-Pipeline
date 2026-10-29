<script setup lang="ts">
import { ref } from "vue";
import ResizeHandle from "@/kit/ResizeHandle.vue";

const width = ref(220);
const height = ref(72);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div style="display: flex; height: 110px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius); overflow: hidden;">
      <div style="flex: 1; padding: 10px;" class="wp-kit__muted">The page</div>
      <ResizeHandle v-model="width" axis="x" reverse :min="140" :max="420" :default-size="220" label="Panel width" />
      <aside :style="{ width: `${width}px`, padding: '10px', background: 'var(--wp-bg-2)' }" class="wp-kit__muted">A side panel, {{ width }} px. Drag its left edge, or focus it and use the arrows.</aside>
    </div>
    <div style="border: 1px solid var(--wp-border); border-radius: var(--wp-radius); overflow: hidden;">
      <div :style="{ height: `${height}px`, padding: '10px', background: 'var(--wp-bg-2)' }" class="wp-kit__muted">A box {{ height }} px tall</div>
      <ResizeHandle v-model="height" axis="y" :min="40" :max="200" :default-size="72" label="Box height" />
    </div>
  </div>
</template>
