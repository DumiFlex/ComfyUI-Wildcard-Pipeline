<script setup lang="ts">
import { ref } from "vue";
import Slider from "@/components/shared/Slider.vue";

const weight = ref(1);
const size = ref(32);
const pct = ref(60);
const brush = ref(24);
</script>

<template>
  <div class="wp-kit__stack">
    <Slider v-model="weight" :min="0" :max="2" :step="0.05" aria-label="Weight" with-input />
    <Slider
      v-model="size"
      :min="4"
      :max="160"
      :marks="[{ value: 16, label: '16' }, { value: 64, label: '64' }, { value: 128, label: '128' }]"
      :format="(v: number) => `${v} px`"
      aria-label="Brush size"
      show-value
    />
    <Slider v-model="pct" size="lg" :format="(v: number) => `${v}%`" aria-label="Threshold" show-value />
    <Slider v-model="pct" disabled aria-label="Disabled" show-value />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Slider v-model="brush" :min="4" :max="160" size="sm" aria-label="Brush" with-input />
    </div>
  </div>
</template>
