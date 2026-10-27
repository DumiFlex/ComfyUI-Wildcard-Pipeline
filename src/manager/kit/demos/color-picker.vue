<script setup lang="ts">
import { ref } from "vue";
import ColorPicker from "../../components/ColorPicker.vue";

const colour = ref("#60a5fa");
const dark = ref("#1f2937");
</script>

<template>
  <div class="wp-kit__row">
    <ColorPicker v-model="colour" aria-label="Category colour" />
    <ColorPicker v-model="dark" aria-label="Dark category colour" />
  </div>
</template>
