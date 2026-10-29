<script setup lang="ts">
import CloseButton from "@/kit/CloseButton.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <CloseButton size="sm" label="Dismiss" />
      <CloseButton kbd="Esc" />
      <CloseButton size="lg" />
      <CloseButton disabled />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <div class="wp-kit__row"><span>Seed list</span><CloseButton size="sm" /></div>
    </div>
  </div>
</template>
