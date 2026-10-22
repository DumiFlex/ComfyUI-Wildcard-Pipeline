<script setup lang="ts">
/**
 * DocUseWhen — "Good for" / "Better with something else" side by side, so a
 * page says when to reach for a feature in a few short bullets.
 */
defineProps<{ good: string[]; better: string[] }>();
</script>

<template>
  <div class="wp-doc-usewhen">
    <div class="wp-doc-usewhen__col wp-doc-usewhen__col--good">
      <div class="wp-doc-usewhen__head"><i class="pi pi-check" aria-hidden="true" /> Good for</div>
      <ul><li v-for="g in good" :key="g">{{ g }}</li></ul>
    </div>
    <div class="wp-doc-usewhen__col wp-doc-usewhen__col--better">
      <div class="wp-doc-usewhen__head"><i class="pi pi-arrow-right" aria-hidden="true" /> Better with something else</div>
      <ul><li v-for="b in better" :key="b">{{ b }}</li></ul>
    </div>
  </div>
</template>

<style scoped>
.wp-doc-usewhen { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) { .wp-doc-usewhen { grid-template-columns: 1fr; } }
.wp-doc-usewhen__col {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 10px 14px;
  background: var(--wp-bg-1);
}
.wp-doc-usewhen__head {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.wp-doc-usewhen__col--good .wp-doc-usewhen__head { color: var(--wp-success, var(--wp-info)); }
.wp-doc-usewhen__col--better .wp-doc-usewhen__head { color: var(--wp-text-muted); }
.wp-doc-usewhen ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.55; }
.wp-doc-usewhen li { margin-bottom: 4px; }
</style>
