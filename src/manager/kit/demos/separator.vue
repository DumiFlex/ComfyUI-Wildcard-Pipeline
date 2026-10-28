<script setup lang="ts">
import Separator from "@/components/shared/Separator.vue";
import Button from "../../components/ui/Button.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <p class="wp-kit__muted">Above the line</p>
    <Separator />
    <p class="wp-kit__muted">Below the line</p>
    <Separator label="or" spacing="md" />
    <div class="wp-kit__row">
      <Button size="sm" variant="ghost">Cut</Button>
      <Button size="sm" variant="ghost">Copy</Button>
      <Separator orientation="vertical" />
      <Button size="sm" variant="ghost">Delete</Button>
    </div>
  </div>
</template>
