<script setup lang="ts">
import { ref } from "vue";
import IconPicker from "../../../kit/IconPicker.vue";

const pickedIcon = ref<string | null>("user");
const noIcon = ref<string | null>(null);
</script>

<template>
  <div class="wp-kit__row">
    <IconPicker v-model="pickedIcon" aria-label="Category icon" />
    <IconPicker v-model="noIcon" aria-label="Empty category icon" />
    <IconPicker v-model="pickedIcon" compact aria-label="Compact category icon" />
  </div>
</template>
