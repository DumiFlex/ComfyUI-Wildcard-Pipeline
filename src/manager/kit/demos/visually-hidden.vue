<script setup lang="ts">
import VisuallyHidden from "@/components/shared/VisuallyHidden.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <p class="wp-kit__caption">Tab here: the link shows while it has focus</p>
    <div class="wp-kit__row">
      <VisuallyHidden as="a" href="#kit-skip-target" focusable>Skip to the library</VisuallyHidden>
      <span>Screen readers hear "3 problems" after the icon:</span>
      <i class="pi pi-exclamation-triangle" aria-hidden="true" /><VisuallyHidden>3 problems</VisuallyHidden>
    </div>
  </div>
</template>
