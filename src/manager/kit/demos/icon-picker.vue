<script setup lang="ts">
import { ref } from "vue";
import IconPicker from "../../components/IconPicker.vue";

const pickedIcon = ref<string | null>("user");
</script>

<template>
  <IconPicker v-model="pickedIcon" aria-label="Category icon" />
</template>
