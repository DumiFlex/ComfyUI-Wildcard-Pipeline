<script setup lang="ts">
import RelativeDate from "../../../kit/RelativeDate.vue";

const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
</script>

<template>
  <span class="wp-kit__inline">Edited <RelativeDate :value="fiveMinAgo" /></span>
  <span class="wp-kit__inline">Edited <RelativeDate :value="yesterday" /></span>
</template>
