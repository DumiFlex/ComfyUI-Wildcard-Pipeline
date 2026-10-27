<script setup lang="ts">
import Chip from "../../components/ui/Chip.vue";
</script>

<template>
  <Chip>portrait</Chip>
  <Chip tone="accent">$mood</Chip>
  <Chip tone="success" icon="pi-check">Rules held</Chip>
  <Chip tone="warn" icon="pi-exclamation-triangle">2 conflicts</Chip>
  <Chip tone="danger">missing $subject</Chip>
  <Chip tone="info">v10</Chip>
  <Chip removable>winter</Chip>
  <Chip color="var(--wp-kind-combine)">Combine</Chip>
</template>
