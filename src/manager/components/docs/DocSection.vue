<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template>
  <section class="wp-doc-section">
    <h2 class="wp-doc-section__h2">{{ title }}</h2>
    <div class="wp-doc-section__body"><slot /></div>
  </section>
</template>
<style scoped>
.wp-doc-section__h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--wp-text-muted); font-weight: 600; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.wp-doc-section__h2::after { content: ""; flex: 1; height: 1px; background: var(--wp-border); }
/* Flex column so every block — paragraphs, lists, key-lists, callouts,
 * and images — gets even vertical rhythm. Fixes images sitting flush
 * against the text above them. */
.wp-doc-section__body { display: flex; flex-direction: column; gap: 16px; font-size: 13.5px; line-height: 1.66; color: var(--wp-text); }
.wp-doc-section__body :deep(p) { margin: 0; }
.wp-doc-section__body :deep(ul), .wp-doc-section__body :deep(ol) { margin: 0; padding-left: 20px; }
.wp-doc-section__body :deep(li) { margin-bottom: 8px; line-height: 1.6; }
.wp-doc-section__body :deep(li:last-child) { margin-bottom: 0; }
/* Key terms pop with accent color, so highlights aren't carried by bold alone. */
.wp-doc-section__body :deep(b), .wp-doc-section__body :deep(strong) { color: var(--wp-accent-text); font-weight: 600; }
</style>
