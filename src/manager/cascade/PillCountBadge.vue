<script setup lang="ts">
/**
 * Tiny count badge for cascade refs. Surfaced next to sub-category
 * chips + option remove buttons to signal "this entity has N
 * incoming references; deleting it routes through the cascade dialog".
 *
 * Token alignment: uses the same `--wp-warn` accent that powers
 * `.wp-chip--warn` elsewhere in the SPA, so badge tone matches the
 * existing visual language (chips, icons, drift markers).
 */
interface Props {
  count: number;
}

defineProps<Props>();
</script>

<template>
  <span v-if="count > 0" class="wp-pill-count">{{ count }}</span>
</template>

<style scoped>
@layer wp-extension {
  .wp-pill-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    color: var(--wp-warn, #f59e0b);
    background: color-mix(in oklab, var(--wp-warn, #f59e0b) 16%, transparent);
    border: 1px solid color-mix(in oklab, var(--wp-warn, #f59e0b) 36%, transparent);
    margin-left: 4px;
  }
}
</style>
