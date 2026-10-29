<script setup lang="ts">
import Button from "../../../kit/Button.vue";
import EmptyState from "../../../kit/EmptyState.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <p class="wp-kit__muted">panel (the default): in a card or side panel, at its own height.</p>
    <EmptyState icon="pi-box" headline="No bundles yet" body="A bundle drops a group of modules onto a Context node in one go.">
      <template #cta><Button variant="primary" icon="pi-plus">New bundle</Button></template>
    </EmptyState>
    <p class="wp-kit__muted">inline: one row in a small box.</p>
    <EmptyState size="inline" icon="pi-search" headline="No matches" variant="no-results">
      <template #cta><Button variant="link" size="sm">Clear filters</Button></template>
    </EmptyState>
    <p class="wp-kit__muted">page: an empty list page (fills about 40% of the window). Error tone shown here.</p>
    <EmptyState size="page" icon="pi-exclamation-triangle" headline="Couldn't load the library" body="The server didn't answer. Check that ComfyUI is running." variant="error">
      <template #cta><Button icon="pi-refresh">Try again</Button></template>
    </EmptyState>
  </div>
</template>
