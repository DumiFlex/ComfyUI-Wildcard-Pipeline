<script setup lang="ts">
interface Props {
  count: number;
}

defineProps<Props>();
</script>

<template>
  <span v-if="count > 0" class="wp-pill-count">{{ count }}</span>
</template>

<style scoped>
.wp-pill-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  background: var(--wp-color-warn-bg, rgba(245, 158, 11, 0.13));
  color: var(--wp-color-warn-fg, #f59e0b);
  margin-left: 4px;
}
</style>
