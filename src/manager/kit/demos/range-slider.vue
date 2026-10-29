<script setup lang="ts">
import { ref } from "vue";
import RangeSlider from "@/kit/RangeSlider.vue";

const weight = ref<[number, number]>([0.6, 1.2]);
const tokens = ref<[number, number]>([40, 120]);
const canvas = ref<[number, number]>([2, 6]);
</script>

<template>
  <div class="wp-kit__stack">
    <RangeSlider v-model="weight" :min="0" :max="2" :step="0.05" aria-label="Weight" with-input />
    <RangeSlider v-model="tokens" :min="0" :max="200" :step="5" :min-gap="20" :format="(v: number) => `${v} tokens`" aria-label="Token budget" />
    <RangeSlider :model-value="[20, 70]" disabled aria-label="Disabled" />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <RangeSlider v-model="canvas" :min="1" :max="10" size="sm" aria-label="Frames" with-input />
    </div>
  </div>
</template>
