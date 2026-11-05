<script setup lang="ts">
/** The Context node's two add buttons, shared by the list footer and the
 *  empty hero. The caller's class (`wp-w-footer` /
 *  `wp-empty-hero-actions`) lands on the wrapper. */
import Button from "@/kit/Button.vue";

defineEmits<{ module: []; bundle: [] }>();
</script>

<template>
  <div>
    <Button size="sm" variant="primary" icon="pi-plus" data-testid="open-picker" @click="$emit('module')">
      Add module
    </Button>
    <Button size="sm" icon="pi-plus" data-testid="open-bundle-picker" @click="$emit('bundle')">
      Add Bundle
    </Button>
  </div>
</template>
