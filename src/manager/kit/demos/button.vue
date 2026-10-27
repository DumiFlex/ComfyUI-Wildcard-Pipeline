<script setup lang="ts">
import Button from "../../components/ui/Button.vue";
</script>

<template>
  <Button variant="primary" icon="pi-plus">New module</Button>
  <Button>Cancel</Button>
  <Button variant="outline" icon="pi-book">Docs</Button>
  <Button variant="ghost" icon="pi-refresh">Refresh</Button>
  <Button variant="danger" icon="pi-trash">Delete</Button>
  <Button variant="link">Open in library</Button>
  <Button variant="ghost" icon="pi-cog" aria-label="Settings" />
  <Button size="sm">Small</Button>
  <Button size="lg" variant="primary">Large</Button>
  <Button loading>Saving</Button>
  <Button disabled>Disabled</Button>
</template>
