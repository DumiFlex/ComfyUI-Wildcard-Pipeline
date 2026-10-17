<script setup lang="ts">
/** The Context node's two add buttons, shared by the list footer and the
 *  empty hero. The caller's class (`wp-w-footer` /
 *  `wp-empty-hero-actions`) lands on the wrapper. */
defineEmits<{ module: []; bundle: [] }>();
</script>

<template>
  <div>
    <button
      class="wp-btn wp-btn--primary"
      data-testid="open-picker"
      @click="$emit('module')"
    >
      <i class="pi pi-plus" /> Add module
    </button>
    <button
      class="wp-btn"
      data-testid="open-bundle-picker"
      @click="$emit('bundle')"
    >
      <i class="pi pi-plus" /> Add Bundle
    </button>
  </div>
</template>
