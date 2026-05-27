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
.wp-doc-section__h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--wp-text-muted); font-weight: 600; margin: 0 0 11px; display: flex; align-items: center; gap: 8px; }
.wp-doc-section__h2::after { content: ""; flex: 1; height: 1px; background: var(--wp-border); }
.wp-doc-section__body { font-size: 13.5px; line-height: 1.62; color: var(--wp-text); }
</style>
