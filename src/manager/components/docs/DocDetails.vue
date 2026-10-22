<script setup lang="ts">
/**
 * DocDetails — a folded "How it works" box. Detail most readers can skip
 * stays on the page (and in the assistant's docs index) without making the
 * page long to read.
 */
withDefaults(defineProps<{ title?: string }>(), { title: "How it works" });
</script>

<template>
  <details class="wp-doc-details">
    <summary class="wp-doc-details__summary">{{ title }}</summary>
    <div class="wp-doc-details__body"><slot /></div>
  </details>
</template>

<style scoped>
.wp-doc-details {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-1);
}
.wp-doc-details__summary {
  cursor: pointer;
  padding: 10px 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wp-text-muted);
  list-style-position: inside;
}
.wp-doc-details__summary:hover { color: var(--wp-text); }
.wp-doc-details__summary:focus-visible { outline: 2px solid var(--wp-accent-500); outline-offset: 2px; }
.wp-doc-details[open] .wp-doc-details__summary { border-bottom: 1px solid var(--wp-border); }
.wp-doc-details__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--wp-text-muted);
}
.wp-doc-details__body :deep(p) { margin: 0; }
.wp-doc-details__body :deep(ul) { margin: 0; padding-left: 20px; }
.wp-doc-details__body :deep(li) { margin-bottom: 6px; }
</style>
