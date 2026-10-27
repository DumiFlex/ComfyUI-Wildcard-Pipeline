<script setup lang="ts">
import Chip from "../../components/ui/Chip.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <Chip>portrait</Chip>
      <Chip tone="accent">$mood</Chip>
      <Chip tone="success" icon="pi-check">Rules held</Chip>
      <Chip tone="warn" icon="pi-exclamation-triangle">2 conflicts</Chip>
      <Chip tone="danger">missing $subject</Chip>
      <Chip tone="info">v10</Chip>
      <Chip color="var(--wp-kind-combine)">Combine</Chip>
    </div>
    <p class="wp-kit__muted">Removable: a plain ✕, same height as a bare chip.</p>
    <div class="wp-kit__row">
      <Chip>winter</Chip>
      <Chip removable>winter</Chip>
      <Chip tone="accent" removable>$mood</Chip>
      <Chip color="var(--wp-kind-wildcard)" removable>Wildcard</Chip>
    </div>
  </div>
</template>
