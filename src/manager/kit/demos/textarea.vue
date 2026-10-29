<script setup lang="ts">
import { ref } from "vue";
import Textarea from "../../../kit/Textarea.vue";

const notes = ref("Warm colours for portraits.");
</script>

<template>
  <div class="wp-kit__stack">
    <Textarea v-model="notes" :rows="3" aria-label="Notes" />
  </div>
</template>
