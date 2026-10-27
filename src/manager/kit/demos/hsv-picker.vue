<script setup lang="ts">
import { ref } from "vue";
import HsvPicker from "@/components/shared/HsvPicker.vue";

const hsv = ref("#6366f1");
</script>

<template>
  <div class="wp-kit__hsv"><HsvPicker v-model="hsv" aria-label="Colour" /></div>
</template>
