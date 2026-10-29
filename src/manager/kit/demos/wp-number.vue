<script setup lang="ts">
import { ref } from "vue";
import WpNumber from "@/kit/WpNumber.vue";

const count = ref<number | null>(4);
const width = ref<number | null>(1024);
const weight = ref<number | null>(1.5);
const budget = ref<number | null>(null);
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
      <WpNumber v-model="count" size="md" disabled aria-label="Disabled count" class="wp-kit__num" />
    </div>
    <p class="wp-kit__muted">Decimals, nullable ("use the default") and invalid.</p>
    <div class="wp-kit__row">
      <WpNumber v-model="weight" :min="0.01" :step="0.1" size="md" aria-label="Weight" class="wp-kit__num" />
      <WpNumber v-model="budget" nullable placeholder="Server" size="md" aria-label="Nullable" class="wp-kit__num" />
      <WpNumber v-model="count" invalid size="md" aria-label="Invalid" class="wp-kit__num" />
    </div>
  </div>
</template>

<style scoped>
.wp-kit__num { width: 120px; }
</style>
