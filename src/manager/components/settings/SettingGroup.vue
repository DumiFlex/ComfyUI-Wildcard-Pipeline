<script setup lang="ts">
/**
 * A titled block of setting rows on one Settings section. The rows sit in a
 * single bordered panel separated by hairlines, so a long section reads as a
 * list rather than a stack of cards.
 */
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="wp-set-group">
    <h3 v-if="title" class="wp-set-group__title">
      {{ title }}<slot name="title-extra" />
    </h3>
    <p v-if="note" class="wp-set-group__note">{{ note }}</p>
    <div class="wp-set-group__panel">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.wp-set-group { margin-bottom: var(--wp-space-7, 24px); }
.wp-set-group__title {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin: 0 0 var(--wp-space-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
.wp-set-group__note {
  margin: 0 0 var(--wp-space-3);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-dim);
}
.wp-set-group__panel {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg, 10px);
}
</style>
