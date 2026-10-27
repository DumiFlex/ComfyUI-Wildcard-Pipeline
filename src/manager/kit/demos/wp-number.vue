<script setup lang="ts">
import { ref } from "vue";
import WpNumber from "@/components/shared/WpNumber.vue";

const count = ref<number | null>(4);
</script>

<template>
  <WpNumber v-model="count" :min="1" :max="64" aria-label="Count" class="wp-kit__compact" />
</template>
