<script setup lang="ts">
/**
 * DocKeyList — a definition list for controls / options / variables.
 * Each row is a highlighted term chip + a plain description, so a page
 * reads as scannable key→meaning pairs instead of a wall of bold bullets.
 */
defineProps<{ items: { term: string; desc: string }[] }>();
</script>

<template>
  <dl class="wp-doc-keys">
    <div v-for="it in items" :key="it.term" class="wp-doc-keys__row">
      <dt class="wp-doc-keys__term">{{ it.term }}</dt>
      <dd class="wp-doc-keys__desc">{{ it.desc }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.wp-doc-keys { margin: 0; display: flex; flex-direction: column; gap: 14px; }
.wp-doc-keys__row {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 16px;
  align-items: start;
}
.wp-doc-keys__term {
  justify-self: start;
  font: 600 12px var(--wp-font-sans);
  color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 11%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 24%, transparent);
  border-radius: 6px;
  padding: 4px 10px;
}
.wp-doc-keys__desc {
  margin: 0;
  color: var(--wp-text-muted);
  line-height: 1.6;
  font-size: 13px;
}
@media (max-width: 600px) {
  .wp-doc-keys__row { grid-template-columns: 1fr; gap: 5px; }
}
</style>
