<script setup lang="ts">
import LoadingMark from "@/components/shared/LoadingMark.vue";
</script>

<template>
  <LoadingMark :size="16" label="Loading" />
  <LoadingMark :size="20">Loading bundle…</LoadingMark>
  <div class="wp-kit__stack"><LoadingMark block>Loading the library…</LoadingMark></div>
</template>
