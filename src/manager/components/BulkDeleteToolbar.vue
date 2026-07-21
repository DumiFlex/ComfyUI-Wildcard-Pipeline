<script setup lang="ts">
/**
 * BulkDeleteToolbar — minimal bulk-action bar for editors whose rows have
 * nothing to bulk-set (fixed-values, constraint exceptions, derivation
 * rules): just "N selected" + Delete + Clear. The richer wildcard bar
 * (apply/remove sub-category, set weight) is SelectionToolbar.
 *
 * Presentational: emits `delete-selected` / `clear`; the host mutates rows +
 * tracks dirty.
 */
import Button from "./ui/Button.vue";

defineProps<{
  count: number;
  /** Plural noun for the Delete label, e.g. "values" → "Delete 3 values". */
  noun?: string;
}>();

const emit = defineEmits<{
  (e: "delete-selected"): void;
  (e: "clear"): void;
}>();
</script>

<template>
  <div class="wpc-deltoolbar" role="toolbar" aria-label="Bulk actions">
    <span class="wpc-deltoolbar__count">{{ count }} selected</span>
    <div class="wpc-deltoolbar__spacer"></div>
    <Button
      variant="danger"
      size="sm"
      icon="pi-trash"
      :disabled="count === 0"
      data-test="bulk-delete"
      @click="emit('delete-selected')"
    >Delete{{ noun ? ` ${count} ${noun}` : "" }}</Button>
    <Button variant="ghost" size="sm" @click="emit('clear')">Clear</Button>
  </div>
</template>

<style scoped>
.wpc-deltoolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid color-mix(in oklab, var(--wp-accent) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent) 12%, var(--wp-bg-2));
  flex-wrap: wrap;
}
.wpc-deltoolbar__count {
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text);
  white-space: nowrap;
}
.wpc-deltoolbar__spacer { flex: 1; }
</style>
