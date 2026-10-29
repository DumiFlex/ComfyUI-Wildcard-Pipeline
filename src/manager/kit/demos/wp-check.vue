<script setup lang="ts">
import { ref } from "vue";
import WpCheck from "@/kit/WpCheck.vue";

const hold = ref(true);
</script>

<template>
  <span class="wp-kit__inline"><WpCheck v-model="hold" aria-label="Hold across the run" /> Hold across the run</span>
</template>
