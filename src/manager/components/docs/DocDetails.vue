<script setup lang="ts">
/**
 * DocDetails — a folded "How it works" box (the kit's Disclosure). Detail
 * most readers can skip stays on the page (and in the assistant's docs
 * index) without making the page long to read.
 */
import Disclosure from "@/components/shared/Disclosure.vue";

withDefaults(defineProps<{ title?: string }>(), { title: "How it works" });
</script>

<template>
  <Disclosure class="wp-doc-details" :label="title" boxed>
    <div class="wp-doc-details__body"><slot /></div>
  </Disclosure>
</template>

<style scoped>
.wp-doc-details__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--wp-text-muted);
}
.wp-doc-details__body :deep(p) { margin: 0; }
.wp-doc-details__body :deep(ul) { margin: 0; padding-left: 20px; }
.wp-doc-details__body :deep(li) { margin-bottom: 6px; }
</style>
