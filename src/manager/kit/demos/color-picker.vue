<script setup lang="ts">
import { ref } from "vue";
import ColorPicker from "../../components/ColorPicker.vue";

const colour = ref("#60a5fa");
</script>

<template>
  <ColorPicker v-model="colour" aria-label="Category colour" />
</template>
