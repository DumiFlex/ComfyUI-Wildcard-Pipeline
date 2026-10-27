<script setup lang="ts">
import { ref } from "vue";
import WpNumber from "@/components/shared/WpNumber.vue";

const count = ref<number | null>(4);
const width = ref<number | null>(1024);
</script>

<template>
  <div class="wp-kit__stack">
    <p class="wp-kit__muted">Sizes: sm 24 (canvas default), md 32 (manager), lg 40.</p>
    <div class="wp-kit__row">
      <WpNumber v-model="count" :min="1" :max="64" aria-label="Count, small" class="wp-kit__num" />
      <WpNumber v-model="count" :min="1" :max="64" size="md" aria-label="Count, medium" class="wp-kit__num" />
      <WpNumber v-model="count" :min="1" :max="64" size="lg" aria-label="Count, large" class="wp-kit__num" />
    </div>
    <div class="wp-kit__row">
      <WpNumber v-model="width" :step="64" size="md" suffix="px" aria-label="Width" class="wp-kit__num" />
      <WpNumber :model-value="8" size="md" disabled aria-label="Disabled count" class="wp-kit__num" />
    </div>
  </div>
</template>

<style scoped>
.wp-kit__num { width: 120px; }
</style>
