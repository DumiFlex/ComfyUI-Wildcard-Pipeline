<script setup lang="ts">
import ProgressBar from "@/components/shared/ProgressBar.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <ProgressBar :value="64" :max="200" label="Testing seeds" show-value />
    <ProgressBar label="Loading the model" show-value />
    <ProgressBar :value="200" :max="200" tone="success" label="All seeds passed" show-value />
    <ProgressBar :value="38" tone="warn" label="Context used" show-value />
    <ProgressBar :value="92" tone="danger" label="Over the budget" show-value />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <ProgressBar :value="3" :max="8" size="sm" label="Loop frame 3 of 8" />
      <ProgressBar size="sm" label="Waiting for the queue" />
    </div>
  </div>
</template>
