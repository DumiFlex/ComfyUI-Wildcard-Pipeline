<script setup lang="ts">
import Button from "../../components/ui/Button.vue";
import EmptyState from "../../components/ui/EmptyState.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <EmptyState icon="pi-box" headline="No bundles yet" body="A bundle drops a group of modules onto a Context node in one go.">
      <template #cta><Button variant="primary" icon="pi-plus">New bundle</Button></template>
    </EmptyState>
  </div>
</template>
